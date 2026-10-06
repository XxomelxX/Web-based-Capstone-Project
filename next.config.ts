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
        // NOTE: Workbox matches against the FULL request URL
        // (e.g. "http://localhost:3000/api/health"), so the pattern must
        // NOT be anchored with ^\/ — an anchored pattern never matches and
        // the request falls through to the NetworkFirst catch-all, which can
        // serve a stale cached 200 while offline (false "Online").
        urlPattern: /\/api\/health/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /\/_next\/static\/.*\.(css|js)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-assets-v1',
          expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /\.(png|jpg|jpeg|svg|gif|webp|woff2?|ttf|ico)$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'media-assets-v1',
          expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.gstatic\.com/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-webfonts',
          expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.googleapis\.com/,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'google-fonts-stylesheets',
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
      {
        urlPattern: /\/api\/(products|categories|lowstock|reports)/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache-v1',
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
        },
      },
      {
        // Next.js App Router RSC payloads (/_next/data + ?_rsc=). Without
        // this, an offline hard refresh can fail the RSC request and render
        // the "__next_error__ / This page couldn't load" screen even when
        // the HTML shell is cached.
        urlPattern: /\/_next\/data\//,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache-v2',
          networkTimeoutSeconds: 3,
        },
      },
      {
        // Next.js App Router RSC payloads (?_rsc= query). Without this,
        // offline navigations/refreshes fail their RSC fetches with
        // ERR_FAILED console spam even when the HTML shell is served.
        // Full-URL match (Workbox matches against the entire request URL).
        urlPattern: /_rsc=/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache-v2',
          networkTimeoutSeconds: 3,
        },
      },
      {
        // POS must keep selling offline: serve cached shell when offline,
        // sync queued sales on reconnect (Dexie queue + clientUuid idempotency).
        // MUST come before the NetworkOnly auth block below.
        // Matches /pos and /pos/* — simple pattern (must survive SW serialization).
        urlPattern: /\/pos/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache-v2',
          networkTimeoutSeconds: 3,
        },
      },
      {
        // Auth-gated app pages must NEVER be served from cache to a
        // logged-out user: always go to network (middleware redirects to /login).
        // NOTE: /pos is intentionally excluded (see NetworkFirst rule above).
        urlPattern: /\/(dashboard|products|categories|orders|credit|expenses|reports|users|settings|lowstock|transaction-log|item-log)/,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: /.*/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache-v2',
          networkTimeoutSeconds: 3,
        },
      },
    ],
  },
  fallbacks: {
    document: '/offline',
  },
});

const nextConfig: NextConfig = {
  turbopack: {},
};

export default withPWA(nextConfig);
