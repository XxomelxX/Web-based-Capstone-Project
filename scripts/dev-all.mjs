// Start the dev stack together:   npm run dev:all
// Local Postgres is started ONLY when the effective DATABASE_URL points at
// localhost (the .env ROLLBACK switch) — otherwise it is skipped so a remote
// DB (Neon) can be used without the local server's lifecycle mattering.
// If local Postgres dies mid-session it is restarted (up to 3 times) instead
// of tearing down Next; Next dying still tears everything down.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const PG_PORT = 5433;
const PG_READY_TIMEOUT_MS = 60000;
const PG_RESTART_LIMIT = 3;
let pgRestarts = 0;

// Resolve DATABASE_URL the same way Next does: process env, then .env.local,
// then .env. Local Postgres is only needed when the URL points at localhost —
// a remote DB (Neon) means the local server's crashes must not kill the stack.
function effectiveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.local', '.env']) {
    try {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const match = /^\s*DATABASE_URL\s*=\s*"?([^"\n#]+)"?/m.exec(text);
      if (match) return match[1].trim();
    } catch {
      // missing env file — keep looking
    }
  }
  return '';
}

const databaseUrl = effectiveDatabaseUrl();
const needsLocalPg = /localhost|127\.0\.0\.1/.test(databaseUrl);

const children = [];
let shuttingDown = false;

function run(label, command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // local-pg.mjs exits 0 when the database is already running — not a failure.
    if (label === 'postgres' && code === 0) return;
    if (label === 'postgres' && pgRestarts < PG_RESTART_LIMIT) {
      pgRestarts += 1;
      console.error(`[dev:all] postgres exited (code=${code} signal=${signal}) — restarting (${pgRestarts}/${PG_RESTART_LIMIT}).`);
      setTimeout(() => run('postgres', 'node', ['scripts/local-pg.mjs']), 1500);
      return;
    }
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

if (needsLocalPg) {
  run('postgres', 'node', ['scripts/local-pg.mjs']);

  const databaseReady = await waitForDatabase();
  if (!databaseReady) {
    console.error(`[dev:all] Postgres did not accept connections on port ${PG_PORT} within ${PG_READY_TIMEOUT_MS / 1000}s.`);
    shutdown(1);
  }

  console.log('[dev:all] Database ready — starting Next.js dev server.');
} else {
  console.log(`[dev:all] DATABASE_URL is remote (${databaseUrl.split('@')[1]?.split('/')[0] ?? 'set'}) — skipping local Postgres.`);
}
run('next', 'npm', ['run', 'dev']);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
