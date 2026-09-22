/**
 * Post-build script: patches the generated service worker to ensure
 * the offline fallback mechanism works reliably.
 *
 * The @ducanh2912/next-pwa library generates a service worker with
 * handlerDidError on each runtime route that calls self.fallback(request).
 * This is sufficient for route-level errors. However, for hard offline
 * navigation (e.g. user navigates to a page that was never cached),
 * we also need setCatchHandler as a safety net so Workbox calls
 * self.fallback for ANY unhandled request — not just the ones that
 * match a runtimeCaching route.
 *
 * If the generated SW already has setCatchHandler, we leave it alone.
 * If it doesn't, we inject it before the final closing.
 */

const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'public', 'sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[patch-sw] sw.js not found, skipping patch.');
  process.exit(0);
}

let content = fs.readFileSync(swPath, 'utf-8');
let changed = false;

// If setCatchHandler was accidentally removed by an older build, re-inject it.
// We look for the last e.registerRoute(...) call and append setCatchHandler after it.
if (!content.includes('setCatchHandler')) {
  // Inject setCatchHandler right before the final semicolon / WB_DISABLE line
  // The generated SW ends with: ...,"GET"),self.__WB_DISABLE_DEV_LOGS=!0});
  // We insert setCatchHandler before that尾巴.
  const marker = 'self.__WB_DISABLE_DEV_LOGS';
  if (content.includes(marker)) {
    content = content.replace(
      marker,
      'e.setCatchHandler(self.fallback),' + marker
    );
    changed = true;
    console.log('[patch-sw] Injected setCatchHandler(self.fallback) as offline fallback safety net.');
  }
}

if (changed) {
  fs.writeFileSync(swPath, content, 'utf-8');
} else {
  console.log('[patch-sw] sw.js is clean, no changes needed.');
}
