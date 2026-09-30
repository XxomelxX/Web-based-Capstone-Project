'use client';

import type { ReactNode } from 'react';

interface ArchivedSectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

/** Shared archived-items card: amber header with count + rows. Hidden when count is 0. */
export function ArchivedSection({ title, count, children }: ArchivedSectionProps) {
  if (count === 0) return null;
  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl shadow overflow-hidden overflow-x-auto">
      <div className="bg-amber-950/30 px-4 py-2 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-amber-400">
          {title} ({count})
        </h2>
      </div>
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-slate-800 text-slate-400">{children}</tbody>
      </table>
    </div>
  );
}
