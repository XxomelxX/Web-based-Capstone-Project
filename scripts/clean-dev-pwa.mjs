import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PWA_ARTIFACT = /^(sw\.js|swe-worker-.*\.js|workbox-.*\.js|fallback-.*\.js)$/;

for (const name of fs.readdirSync(PUBLIC_DIR)) {
  if (!PWA_ARTIFACT.test(name)) continue;
  fs.rmSync(path.join(PUBLIC_DIR, name), { force: true });
  console.log(`[predev] removed stale PWA artifact public/${name}`);
}
