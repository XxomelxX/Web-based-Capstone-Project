// Instant page-shape placeholder shown while data loads, so navigation paints
// UI immediately instead of a blank area or bare spinner. Tailwind-only — no
// new dependencies. Matches the dashboard's dark panel styling.
type Variant = 'dashboard' | 'table' | 'form';

function Block({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-800/60 ${className}`} />;
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[2rem] border border-slate-800/70 bg-slate-950/90 p-6 ${className}`}>
      {children}
    </div>
  );
}

export function PageSkeleton({ variant = 'table' }: { variant?: Variant }) {
  if (variant === 'dashboard') {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading page">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Panel key={i} className="p-5">
              <Block className="h-3 w-24" />
              <Block className="mt-4 h-8 w-24" />
            </Panel>
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel>
            <Block className="h-4 w-44" />
            <Block className="mt-5 h-56 w-full" />
          </Panel>
          <Panel>
            <Block className="h-4 w-40" />
            <Block className="mt-5 h-56 w-full" />
          </Panel>
        </div>
        <Panel>
          <Block className="h-4 w-52" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Block key={i} className="h-11 w-full" />
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className="max-w-2xl space-y-5" aria-busy="true" aria-label="Loading form">
        <Block className="h-7 w-52" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Block className="h-3 w-28" />
            <Block className="h-10 w-full" />
          </div>
        ))}
        <Block className="h-10 w-36 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading list">
      <Block className="h-10 w-full max-w-md" />
      <Panel>
        <Block className="h-4 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Block key={i} className="h-11 w-full" />
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default PageSkeleton;
