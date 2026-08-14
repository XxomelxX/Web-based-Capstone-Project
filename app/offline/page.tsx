'use client';

import Link from 'next/link';

export default function OfflinePage() {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100"
      style={{
        backgroundImage: "url('/mountain.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-800/80 bg-slate-950/80 p-8 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-3xl">
            📡
          </div>
          <h1 className="text-2xl font-bold text-slate-100">You&apos;re Offline</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Sari-Sari POS can&apos;t reach the server right now. Pages you&apos;ve already opened may
            still work — try going back to POS or dashboard.
          </p>
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
