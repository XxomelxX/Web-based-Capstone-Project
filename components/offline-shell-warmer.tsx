'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Pages the SW fallback redirects users to / that must always work offline.
const ALWAYS_WARM = ['/pos', '/dashboard'] as const;

const PAGES_CACHE = 'pages-cache-v3';
const DEBOUNCE_MS = 800;

async function hasIdentity(): Promise<boolean> {
  try {
    const { readIdentity } = await import('@/lib/client/identity');
    return readIdentity() !== null;
  } catch {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('sari-pos-identity') !== null;
    } catch {
      return false;
    }
  }
}

/**
 * Cache the HTML shell for a path in pages-cache-v3 so a later offline hard
 * navigation is served the real app shell instead of /offline.
 *
 * SPA (client-side) navigations never produce a full document response, which
 * is why pages reached only via <Link> have no cached shell. This fetches the
 * document explicitly — but only for authenticated users (an unauthenticated
 * fetch would cache a login redirect under the page's key).
 */
async function warmShell(path: string): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  if (!(await hasIdentity())) return;
  try {
    const cache = await caches.open(PAGES_CACHE);
    const existing = await cache.match(path, { ignoreSearch: true });
    if (existing) return;
    const res = await fetch(window.location.origin + path, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!res.ok || res.redirected) return; // never cache redirects (login)
    const ctype = res.headers.get('content-type') || '';
    if (!ctype.includes('text/html')) return;
    const body = await res.text();
    if (body.length < 500) return;
    await cache.put(
      path,
      new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  } catch {
    /* best-effort */
  }
}

export function OfflineShellWarmer() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith('/login') || pathname.startsWith('/offline')) return;
    const timer = setTimeout(() => {
      void warmShell(pathname);
      for (const page of ALWAYS_WARM) void warmShell(page);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
