'use client';

import { useEffect } from 'react';

/**
 * What a visitor sees when the page throws.
 *
 * Without this, Next shows a bare grey line of text on an otherwise empty
 * page, with nothing to click. The most common cause on a site that deploys
 * often is not a bug at all: a tab left open across a release asks for a
 * JavaScript chunk whose filename no longer exists, and reloading fixes it
 * completely. So that case reloads itself, once, and everything else offers
 * the two things worth offering — try again, or go somewhere that works.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const stale = isStaleBuild(error);

  useEffect(() => {
    if (!stale) return;
    // Guarded so a genuinely broken page cannot reload in a loop.
    const key = 'rm:reloaded-for-stale-build';
    try {
      if (sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    } catch {
      // Private browsing can refuse sessionStorage. Better to show the message
      // below than to risk reloading forever.
    }
  }, [stale]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-5 py-20 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
        {stale ? 'The site was updated' : 'Something went wrong'}
      </p>

      <h1 className="mt-4 font-display text-3xl text-slate">
        {stale ? 'Reloading to catch up' : 'This page did not load'}
      </h1>

      <p className="mt-4 text-sm leading-relaxed text-slate-dim">
        {stale
          ? 'A new version of the site went live while this tab was open, so part of the page it was waiting for no longer exists. Reloading is all that is needed.'
          : 'Nothing you did caused this, and nothing you were part-way through has been lost — orders, bids and saved items are stored as they are made, not when a page finishes loading.'}
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
        >
          Reload the page
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-sand-line px-7 py-2.5 text-sm text-slate transition-colors hover:border-accent-deep"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-full border border-sand-line px-7 py-2.5 text-sm text-slate transition-colors hover:border-accent-deep"
        >
          Go to the homepage
        </a>
      </div>

      {error.digest !== undefined && (
        <p className="mt-8 font-mono text-[11px] text-slate-dim">
          If you report this, quote {error.digest}
        </p>
      )}
    </main>
  );
}

/**
 * Whether this looks like a tab that outlived its build.
 *
 * Chunk-load failures are the signature. Matched on the error name and message
 * rather than an exact string, because the wording differs between browsers.
 */
function isStaleBuild(error: Error): boolean {
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    text.includes('chunkloaderror') ||
    text.includes('loading chunk') ||
    text.includes('failed to fetch dynamically imported module') ||
    text.includes('importing a module script failed')
  );
}
