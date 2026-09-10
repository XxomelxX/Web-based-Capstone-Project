/**
 * Post-build script: patches the generated service worker to add
 * setCatchHandler(self.fallback) so the /offline page is served
 * when all caching strategies fail (e.g., offline hard-refresh).
 */

const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'public', 'sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[patch-sw] sw.js not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(swPath, 'utf-8');

if (content.includes('setCatchHandler')) {
  console.log('[patch-sw] sw.js already patched, skipping.');
  process.exit(0);
}

const precacheStart = content.indexOf('e.precacheAndRoute(');
if (precacheStart === -1) {
  console.error('[patch-sw] Could not find precacheAndRoute in sw.js');
  process.exit(1);
}

let depth = 0;
let precacheEnd = -1;
for (let i = precacheStart + 'e.precacheAndRoute'.length; i < content.length; i++) {
  if (content[i] === '(' || content[i] === '[' || content[i] === '{') depth++;
  if (content[i] === ')' || content[i] === ']' || content[i] === '}') depth--;
  if (depth === 0) {
    precacheEnd = i + 1;
    break;
  }
}

if (precacheEnd === -1) {
  console.error('[patch-sw] Could not find end of precacheAndRoute call');
  process.exit(1);
}

const patched =
  content.slice(0, precacheEnd) +
  ',e.setCatchHandler(self.fallback)' +
  content.slice(precacheEnd);

fs.writeFileSync(swPath, patched, 'utf-8');
console.log('[patch-sw] Successfully patched sw.js with setCatchHandler');
