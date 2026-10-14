'use client';

/**
 * Offline navigation must be a FULL DOCUMENT load, not a client-side RSC
 * navigation.
 *
 * Next's client router fetches an RSC payload for every navigation
 * (`/pos?_rsc=1abc2def`). The `?_rsc` value is a fresh hash per navigation, so
 * the service worker could never have cached it — offline each click produced a
 * failed request (the `?_rsc=` ERR_FAILED entries in DevTools) and the user
 * landed on a blank/half-rendered screen (or got bounced back). A plain
 * document load ("hard refresh") hits the precached HTML shell instead, which
 * is exactly the path that already worked offline.
 *
 * Installed once from <Providers/>.
 */
const INSTALLED_FLAG = '__sariPosOfflineNavInstalled';

export function installOfflineNavigation() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTALLED_FLAG]) return;
  w[INSTALLED_FLAG] = true;

  document.addEventListener(
    'click',
    (event) => {
      // Online → normal client-side routing.
      if (navigator.onLine) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      // Let the browser handle new-tab / new-window / download / modified clicks.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same page (e.g. "#" anchors stripped above, or a self-link) — leave it.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(url.href);
    },
    true
  );
}