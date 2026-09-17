'use client';

/**
 * Opens the browser's print dialog.
 *
 * A client component for one line of JavaScript, because `window.print()` has
 * no server-rendered equivalent — there is no form or link that opens a print
 * dialog.
 *
 * Deliberately not a "download PDF" button. Every browser's print dialog can
 * already save to PDF, it does it with the user's own paper size and margins,
 * and the alternative is shipping a PDF library to render a document the
 * browser can already lay out correctly.
 */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-primary px-6 py-2 text-xs font-medium text-cream transition-colors hover:bg-secondary"
    >
      {label}
    </button>
  );
}
