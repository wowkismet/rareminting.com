'use client';

/**
 * The last resort.
 *
 * error.tsx sits inside the root layout, so it cannot catch a failure in the
 * layout itself. This one replaces the whole document when that happens, which
 * is why it carries its own html and body and cannot rely on the site's
 * stylesheet having loaded — the styles here are inline for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          color: '#101828',
          fontFamily: 'Georgia, "Times New Roman", serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <p
            style={{
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: '0.625rem',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              color: '#0b5cff',
              margin: 0,
            }}
          >
            Rare Minting
          </p>

          <h1 style={{ fontSize: '1.75rem', margin: '1rem 0 0', fontWeight: 400 }}>
            The site did not load
          </h1>

          <p style={{ color: '#667085', lineHeight: 1.6, fontSize: '0.9rem' }}>
            This is our fault rather than yours. Nothing you were part-way through has been lost —
            orders, bids and saved items are stored as they are made.
          </p>

          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#071a2b',
                color: '#ffffff',
                padding: '0.7rem 1.75rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Reload the page
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: '999px',
                border: '1px solid #dde3ea',
                backgroundColor: 'transparent',
                color: '#101828',
                padding: '0.7rem 1.75rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>

          {error.digest !== undefined && (
            <p
              style={{
                marginTop: '2rem',
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: '0.7rem',
                color: '#667085',
              }}
            >
              If you report this, quote {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
