'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#020617',
          color: '#f1f5f9',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            {offline ? "You're Offline" : 'This page couldn\u2019t load'}
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, color: '#94a3b8' }}>
            {offline
              ? 'Pages you already opened are cached and keep working from local data. Reconnect or go back.'
              : 'Reload to try again, or go back.'}
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 18px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              style={{
                background: 'transparent',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '10px 18px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
