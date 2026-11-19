'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#F4F6FA',
          color: '#0D1B2A',
          fontFamily: 'system-ui, sans-serif',
          padding: 16,
        }}
      >
        <main style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>Codevibe Sign could not load</h1>
          <p style={{ color: '#526277' }}>
            Something failed before the page could start. Try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#1B6AE0',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
