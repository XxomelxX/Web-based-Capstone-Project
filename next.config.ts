import type { NextConfig } from 'next';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // SW intentionally off in dev — test with npm run build && npm run start
  fallbacks: {
    document: '/offline',
  },
  runtimeCaching: [
    {
      urlPattern: /^\/api\/(products|categories|lowstock|reports)/,
      handler: 'NetworkFirst',
      options: { cacheName: 'sari-sari-api-cache', networkTimeoutSeconds: 3, expiration: { maxEntries: 50, maxAgeSeconds: 86400 } },
    },
    {
      urlPattern: /^\/(dashboard|pos|products|categories|lowstock|orders|utang|settings)/,
      handler: 'NetworkFirst',
      options: { cacheName: 'sari-sari-pages-cache', networkTimeoutSeconds: 3 },
    },
  ],
});

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withPWA(nextConfig);
