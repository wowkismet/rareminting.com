import { COMPANY, formattedAddress } from '@rareminting/config';

/**
 * The legal footer, shared by every page.
 *
 * Shared rather than repeated because the entity details are legally
 * significant: a CIN that differs between two pages is a real problem, and the
 * only reliable way to prevent that is to render both from the same source.
 *
 * Policy links appear only for pages that exist. A dead link to a Terms page is
 * worse than no link at all.
 */
export function SiteFooter({ noteCount }: { noteCount?: number | undefined }) {
  return (
    <footer className="bg-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-12">
        <p className="max-w-3xl text-xs leading-relaxed text-cream-dim">
          {COMPANY.brand} is a brand of{' '}
          <span className="text-cream">{COMPANY.legalName}</span>. It is an independent
          collectibles marketplace, and is not affiliated with, endorsed by, or licensed by the
          Reserve Bank of India, the India Government Mint, or any government body. Notes are
          offered as numismatic collectibles at a collector&rsquo;s premium, not as currency
          exchange.
        </p>

        <address className="max-w-3xl text-xs not-italic leading-relaxed text-cream-dim">
          {formattedAddress()}
          <br />
          <span className="font-mono">
            CIN {COMPANY.cin} · GSTIN {COMPANY.gstin}
          </span>
        </address>

        {/* Terms, Privacy, Shipping and Contact are still to be written; they
            are omitted rather than linked to pages that do not exist. */}
        <nav aria-label="Policies" className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <a className="text-cream-dim transition-colors hover:text-accent-bright" href="/refunds">
            Refunds &amp; cancellations
          </a>
        </nav>

        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream-dim">
          www.rareminting.com
          {noteCount === undefined ? '' : ` · ${noteCount} notes · seed catalogue`} · prototype
        </p>
      </div>
    </footer>
  );
}
