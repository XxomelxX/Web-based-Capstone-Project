'use client';

import { useEffect, useState } from 'react';

export function LiveClock() {
  // null until mounted: first client render matches server HTML (no hydration mismatch)
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Immediate set avoids hydration mismatch (server HTML has no time yet).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  return (
    <div className="flex items-center justify-center gap-3 bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5 backdrop-blur-md">
      <span className="text-slate-400 text-xs font-medium">
        {now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </span>
      <span className="w-px h-4 bg-slate-700" aria-hidden="true" />
      <span className="text-cyan-400 font-mono font-bold text-sm tabular-nums">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
      </span>
    </div>
  );
}
