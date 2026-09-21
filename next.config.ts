import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
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
        urlPattern: /^\/api\/(products|categories|lowstock|reports)/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache-v1',
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
        },
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
