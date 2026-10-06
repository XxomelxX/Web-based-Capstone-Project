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

// "/" is a per-session 307 redirect (session-aware page.tsx). Never cache it
// in start-url: a cached /login redirect would be served to a logged-in user
// offline (and vice versa). NetworkOnly + fallback handles offline correctly.
const startUrlNetworkFirst = 'e.registerRoute("/",new e.NetworkFirst(';
if (content.includes(startUrlNetworkFirst)) {
  content = content.replace(startUrlNetworkFirst, 'e.registerRoute("/",new e.NetworkOnly(');
  changed = true;
  console.log('[patch-sw] Forced start-url (/) to NetworkOnly (per-session redirect, must not cache).');
}

// The generated bare `NetworkOnly` auth-pages route has NO handlerDidError
// plugin, so an offline navigation hard-fails with ERR_FAILED instead of
// serving the /offline fallback (route-level miss + empty runtime cache).
// Inject the fallback plugin so it behaves like every other route.
// NOTE: online behavior is unchanged — NetworkOnly still always hits network.
const bareAuthRoute = 'e.registerRoute(/\\/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log)/,new e.NetworkOnly,"GET")';
if (content.includes(bareAuthRoute)) {
  content = content.replace(
    bareAuthRoute,
    'e.registerRoute(/\\/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log)/,new e.NetworkOnly({plugins:[{handlerDidError:async({request:e})=>"undefined"!=typeof self?self.fallback(e):Response.error()}]}),"GET")'
  );
  changed = true;
  console.log('[patch-sw] Attached fallback plugin to bare NetworkOnly auth route (offline navigations now serve /offline).');
}
// setCatchHandler safety net — GUARDED. A bare `e.setCatchHandler(...)` call
// threw `TypeError: not a function` on some builds (minifier scope differences),
// which killed the global fallback AND spammed the console. The guard makes a
// miss impossible to throw; per-route handlerDidError plugins still cover
// offline fallback even if the global handler can't attach.
const guardedCatchHandler = '!function(){try{if(typeof e!=="undefined"&&e&&typeof e.setCatchHandler==="function"){e.setCatchHandler(self.fallback)}}catch(_){}}()';
if (content.includes('e.setCatchHandler(self.fallback)')) {
  content = content.replace('e.setCatchHandler(self.fallback)', guardedCatchHandler);
  changed = true;
  console.log('[patch-sw] Hardened setCatchHandler call with typeof+try guard (fixes "not a function" crash).');
}
// We look for the last e.registerRoute(...) call and append setCatchHandler after it.
if (!content.includes('setCatchHandler')) {
  // Inject setCatchHandler right before the final semicolon / WB_DISABLE line
  // The generated SW ends with: ...,"GET"),self.__WB_DISABLE_DEV_LOGS=!0});
  // We insert setCatchHandler before that尾巴.
  const marker = 'self.__WB_DISABLE_DEV_LOGS';
  if (content.includes(marker)) {
    content = content.replace(
      marker,
      guardedCatchHandler + ',' + marker
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

// Post-build assertions: fail the build loudly if the offline contract broke.
const failures = [];
if (!content.includes('setCatchHandler')) failures.push('missing setCatchHandler');
if (!content.includes('self.fallback')) failures.push('missing self.fallback (/offline)');
if (!content.includes('registerRoute(/\\/pos/')) failures.push('missing /pos route (offline POS shell)');
if (!content.includes('_rsc=')) failures.push('missing _rsc rule (App Router RSC offline coverage)');
if (!content.includes('/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log)/,new e.NetworkOnly({plugins')) failures.push('auth NetworkOnly route missing fallback plugin');
if (failures.length) {
  console.error('[patch-sw] ASSERT FAILED: ' + failures.join(', '));
  process.exit(1);
}
console.log('[patch-sw] ASSERT OK: fallback + /pos offline routing present.');
