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

// Auth module shells are NetworkFirst (full-offline app). Older builds emitted
// a bare `NetworkOnly` route with NO handlerDidError plugin, which hard-failed
// offline with ERR_FAILED. If that legacy shape is present, inject the fallback
// plugin so it behaves like every other route.
const bareAuthRoute = 'e.registerRoute(/\\/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log|inventory)/,new e.NetworkOnly,"GET")';
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

// ---------------------------------------------------------------------------
// Smarter SW fallback: patch the generated fallback asset (public/fallback-*.js).
//
// The generated asset only does `caches.match('/offline', {ignoreSearch:true})`
// for document requests, which loses the original URL and serves /offline even
// when the requested page's HTML shell IS cached. The asset is importScripts()'d
// by sw.js at startup (before routes register), so overriding self.fallback here
// at EOF takes effect for both per-route handlerDidError calls and the global
// setCatchHandler captured at registration time.
//
// Override behavior for document destinations:
//   1. Try the requested URL in any cache (serve the REAL cached shell, if any).
//   2. Otherwise serve /offline, injecting window.__FALLBACK_FOR__ = pathname so
//      the offline page can show which page failed and auto-retry it.
// Plain ES5-ish syntax only (runs in a ServiceWorker; no optional chaining).
// ---------------------------------------------------------------------------
const fallbackDir = path.join(__dirname, '..', 'public');
const fallbackMarker = '__SARI_FALLBACK_OVERRIDE__';
const fallbackOverride = `/* ${fallbackMarker} */
var __wbOrigFallback = self.fallback;
self.fallback = async function (e) {
  try {
    var request = e instanceof Request ? e : (e && e.request) || null;
    var url = (request && request.url) || (e && e.url) || '';
    var destination = (e && e.destination) || (request && request.mode === 'navigate' ? 'document' : '');
    if (destination === 'document') {
      var hit = await caches.match(request || url, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      var offline = await caches.match('/offline', { ignoreSearch: true, ignoreVary: true });
      if (offline) {
        var pathname = '';
        try { pathname = new URL(url, self.location.origin).pathname; } catch (_) {}
        if (!pathname || pathname === '/offline') return offline;
        var html = await offline.text();
        var snippet = '<script>window.__FALLBACK_FOR__=' + JSON.stringify(pathname) + ';</script></body>';
        var patched = html.indexOf('</body>') !== -1 ? html.replace('</body>', snippet) : html + snippet;
        return new Response(patched, { status: 200, statusText: 'OK', headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    }
  } catch (_) {}
  try { return await __wbOrigFallback(e); } catch (_) { return Response.error(); }
};
`;

let fallbackFiles = [];
try {
  fallbackFiles = fs
    .readdirSync(fallbackDir)
    .filter((name) => /^fallback-.*\.js$/.test(name))
    .sort();
} catch (_) {
  fallbackFiles = [];
}
for (const file of fallbackFiles) {
  const filePath = path.join(fallbackDir, file);
  let asset = fs.readFileSync(filePath, 'utf-8');
  if (asset.includes(fallbackMarker)) {
    console.log(`[patch-sw] ${file} already has fallback override, skipping.`);
    continue;
  }
  if (!asset.endsWith('\n')) asset += '\n';
  // Append AFTER the asset's closing IIFE (EOF) — new line, top-level override.
  asset += fallbackOverride;
  fs.writeFileSync(filePath, asset, 'utf-8');
  console.log(`[patch-sw] Appended fallback URL-context override to ${file}.`);
}

// Post-build assertions: fail the build loudly if the offline contract broke.
const failures = [];
if (!content.includes('setCatchHandler')) failures.push('missing setCatchHandler');
if (!content.includes('self.fallback')) failures.push('missing self.fallback (/offline)');
// The POS shell rule may be the legacy /\/pos/ or the extended
// /\/(pos|dashboard|orders|credit)/ fast-timeout rule — accept either shape.
const posRouteOk =
  content.includes('registerRoute(/\\/pos/') ||
  content.includes('registerRoute(/\\/(pos|dashboard|orders|credit)/');
if (!posRouteOk) failures.push('missing /pos route (offline POS shell)');
if (!content.includes('_rsc=')) failures.push('missing _rsc rule (App Router RSC offline coverage)');
const moduleShellRe = '/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log|inventory)/';
const authShellOk =
  content.includes(`${moduleShellRe},new e.NetworkFirst(`) ||
  content.includes(`${moduleShellRe},new e.NetworkOnly({plugins`);
if (!authShellOk) failures.push('auth module shells not offline-capable (need NetworkFirst or patched NetworkOnly)');
let fallbackOverrideOk = fallbackFiles.length > 0;
for (const file of fallbackFiles) {
  try {
    if (!fs.readFileSync(path.join(fallbackDir, file), 'utf-8').includes(fallbackMarker)) {
      fallbackOverrideOk = false;
    }
  } catch (_) {
    fallbackOverrideOk = false;
  }
}
if (!fallbackOverrideOk) failures.push('fallback override missing');
if (failures.length) {
  console.error('[patch-sw] ASSERT FAILED: ' + failures.join(', '));
  process.exit(1);
}
console.log('[patch-sw] ASSERT OK: fallback + /pos offline routing present.');
