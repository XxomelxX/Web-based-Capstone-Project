/**
 * Post-build script: patches the generated service worker to ensure
 * the fallback mechanism works for offline hard-refresh.
 *
 * NOTE: setCatchHandler is NOT needed because each runtimeCaching route
 * already has handlerDidError that calls self.fallback(request), which
 * maps to the /offline page. This script only strips any leftover broken
 * setCatchHandler calls from old builds.
 */

const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'public', 'sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[patch-sw] sw.js not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(swPath, 'utf-8');

// Remove any leftover broken setCatchHandler call from old builds
if (content.includes('e.setCatchHandler(self.fallback)')) {
  content = content.replace(',e.setCatchHandler(self.fallback)', '');
  fs.writeFileSync(swPath, content, 'utf-8');
  console.log('[patch-sw] Removed broken setCatchHandler call (route-level handlers already cover fallback)');
} else {
  console.log('[patch-sw] sw.js is clean, no changes needed.');
}
