const CACHE_NAME = 'sari-sari-pos-shell-v1';
const CORE_ASSETS = ['/', '/favicon.ico', '/offline.html'];
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

const offlineHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><div style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#e2e8f0;margin:0;"><div style="max-width:28rem;padding:2rem;border:1px solid rgba(148,163,184,.25);border-radius:1rem;background:#020617;"><h1 style="margin-top:0;font-size:2rem;">Offline</h1><p style="margin:.75rem 0 1rem;line-height:1.6;">The app is offline. Refresh once you are online again.</p><p style="margin:0;color:#94a3b8;">Cached pages may be unavailable in development mode.</p></div></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_ASSETS.filter((asset) => asset !== '/offline.html')).catch(() => null);
      await cache.put('/offline.html', new Response(offlineHtml, { headers: { 'Content-Type': 'text/html' } }));
    }).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (IS_DEV) return;
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;
  if (requestUrl.pathname === '/sw.js') return;

  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const fallbackResponse = await cache.match('/offline.html');
          return fallbackResponse || new Response(offlineHtml, { headers: { 'Content-Type': 'text/html' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
        });
      }
    })()
  );
});
