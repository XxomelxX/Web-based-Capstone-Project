'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

export const dynamic = 'force-static';

declare global {
  interface Window {
    __FALLBACK_FOR__?: string;
  }
}

// One-shot auto-retry guard: set right before an automatic navigation so a
// failed retry can never bounce back into another automatic navigation.
const RETRY_GUARD_PREFIX = 'sari-fb-tried-';

// External-store adapter for window.__FALLBACK_FOR__ (injected inline by the
// SW fallback override in scripts/patch-sw.js). getServerSnapshot keeps the
// hydration render identical to the server HTML; the real value is then read
// on the client without a setState-in-effect cascading render.
const subscribeToFallback = () => () => {};
const getFallbackSnapshot = () =>
  typeof window !== 'undefined' ? window.__FALLBACK_FOR__ ?? null : null;
const getFallbackServerSnapshot = () => null;

export default function OfflinePage() {
  const fallbackFor = useSyncExternalStore(
    subscribeToFallback,
    getFallbackSnapshot,
    getFallbackServerSnapshot
  );

  // ONE-SHOT auto-retry: we only got here because the page wasn't cached.
  // If the device is actually online, send the user straight back to the
  // network-backed page — but only once per path (sessionStorage guard).
  useEffect(() => {
    if (!fallbackFor) return;
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    try {
      const guardKey = RETRY_GUARD_PREFIX + fallbackFor;
      if (window.sessionStorage.getItem(guardKey)) return;
      window.sessionStorage.setItem(guardKey, '1');
    } catch {
      // Storage unavailable (private mode): never risk a reload loop.
      return;
    }
    window.location.assign(fallbackFor);
  }, [fallbackFor]);

  // When connectivity returns, clear the one-shot guard and reload once so the
  // user lands on the live network page instead of the cached fallback.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      if (fallbackFor) {
        try {
          window.sessionStorage.removeItem(RETRY_GUARD_PREFIX + fallbackFor);
        } catch {
          /* best-effort */
        }
      }
      window.location.reload();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [fallbackFor]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030d08] text-slate-100">
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-emerald-900/60 bg-[#071710]/90 p-8 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-3xl">
            📡
          </div>
          <h1 className="text-2xl font-bold text-slate-100">You&apos;re Offline</h1>
          {fallbackFor ? (
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Offline — <span className="font-semibold text-slate-200">{fallbackFor}</span> isn&apos;t
              cached on this device yet.
            </p>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              J &amp; J Merchandise Store can&apos;t reach the server right now. Pages you&apos;ve
              already opened may still work — try going back to POS or dashboard.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Offline sales are saved locally and sync when you reconnect.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Try Again
            </button>
            {fallbackFor ? (
              <button
                type="button"
                onClick={() => window.location.assign(fallbackFor)}
                className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                Open {fallbackFor}
              </button>
            ) : null}
            <Link
              href="/pos"
              className="rounded-xl bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-700"
            >
              Go to POS (works offline)
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
