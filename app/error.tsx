'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Root Error]', error);
  }, [error]);

  const isOffline = typeof window !== 'undefined' && !navigator.onLine;

  return (
    <html lang="en" className="h-full antialiased" data-theme="dark">
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-slate-800/80 bg-slate-950/80 p-8 text-center shadow-2xl backdrop-blur-md">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle size={28} className="text-amber-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-100">
              {isOffline ? "You're Offline" : "Something went wrong"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              {isOffline
                ? "J & J Merchandise Store can't reach the server right now. Pages you've already opened may still work — try going back to the dashboard."
                : "An unexpected error occurred. Please try again or go to the dashboard."}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {isOffline && "Offline sales are saved locally and sync when you reconnect."}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => reset()}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 cursor-pointer"
              >
                <RefreshCw size={16} />
                Try Again
              </button>
              <a
                href="/dashboard"
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                <Home size={16} />
                Go to Dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
