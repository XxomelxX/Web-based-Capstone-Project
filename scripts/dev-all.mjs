// Start the local database and the Next.js dev server together:
//   npm run dev:all
// Waits for Postgres to accept connections before booting Next, so the first
// dashboard load never races an empty port. If either process dies, the other
// is torn down too — the API can't come up against a database that isn't running.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const PG_PORT = 5433;
const PG_READY_TIMEOUT_MS = 60000;

const children = [];
let shuttingDown = false;

function run(label, command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // local-pg.mjs exits 0 when the database is already running — not a failure.
    if (label === 'postgres' && code === 0) return;
    console.error(`[dev:all] ${label} exited (code=${code} signal=${signal}) — shutting the other process down.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function killTree(child) {
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // already gone
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  process.exit(code);
}

function waitForDatabase(timeoutMs = PG_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port: PG_PORT, host: '127.0.0.1' });
      const finish = (ok) => {
        socket.removeAllListeners();
        socket.destroy();
        if (ok) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(attempt, 500);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    };
    attempt();
  });
}

run('postgres', 'node', ['scripts/local-pg.mjs']);

const databaseReady = await waitForDatabase();
if (!databaseReady) {
  console.error(`[dev:all] Postgres did not accept connections on port ${PG_PORT} within ${PG_READY_TIMEOUT_MS / 1000}s.`);
  shutdown(1);
}

console.log('[dev:all] Database ready — starting Next.js dev server.');
run('next', 'npm', ['run', 'dev']);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
