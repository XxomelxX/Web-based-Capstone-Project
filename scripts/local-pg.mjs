// Local Postgres for development when Neon is unreachable from this network.
// Data lives in .local-pg-data/ at the project root (gitignored) so it is never
// wiped by OS temp-folder cleanup. Port 5433 to avoid clashing with any system
// Postgres on 5432.
import EmbeddedPostgres from 'embedded-postgres';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_DIR = path.join(PROJECT_ROOT, '.local-pg-data');
const PORT = 5433;

function isPortReady(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}

// Already running (e.g. dev:all re-run, or a previous terminal still holds it):
// exit cleanly instead of crashing on the port conflict.
if (await isPortReady(PORT)) {
  console.log(`ALREADY_RUNNING port=${PORT}`);
  process.exit(0);
}

const pg = new EmbeddedPostgres({
  databaseDir: DATABASE_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: true,
});

try {
  await pg.initialise();
  console.log('CLUSTER_INITIALISED');
} catch (e) {
  console.log('CLUSTER_EXISTS ' + (e instanceof Error ? e.message : e));
}

await pg.start();
console.log(`LOCAL_PG_READY port=${PORT}`);

try {
  await pg.createDatabase('sarisari');
  console.log('DB_CREATED sarisari');
} catch (e) {
  console.log('DB_EXISTS ' + (e instanceof Error ? e.message : e));
}

// Stay alive until killed.
setInterval(() => {}, 60000);
