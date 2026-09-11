import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        urlPattern: /^\/api\/health/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /^\/_next\/static\//,
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: /^\/api\/.*/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
        },
      },
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|ico|webp)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'images-cache',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
      {
        urlPattern: ({ request }: { request: Request }) =>
          request.destination === 'document' &&
          !request.url.includes('/_next/') &&
          !request.url.includes('/api/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
          cacheableResponse: { statuses: [200] },
          matchOptions: { ignoreSearch: false, ignoreVary: true },
          plugins: [
            {
              cacheWillUpdate: async ({ response }: { response: Response }) => {
                if (!response || response.status !== 200) return null;
                const ct = response.headers.get('content-type') || '';
                if (!ct.includes('text/html')) return null;
                try {
                  const body = await response.clone().text();
                  if (!body || body.length < 500) return null;
                } catch {
                  return null;
                }
                return response;
              },
            },
          ],
        },
      },
    ],
  },
  fallbacks: {
    document: undefined,
  },
});

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withPWA(nextConfig);
