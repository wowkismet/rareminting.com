import type { Metadata } from 'next';

import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Auctions',
  description: 'Timed auctions for the rarest notes on Rare Minting.',
  alternates: { canonical: '/auctions' },
};
export const dynamic = 'force-dynamic';

/**
 * Auctions.
 *
 * The database is ready for these — auctions, an append-only bid ledger,
 * anti-sniping and deposits all exist as tables. The bidding service does not,
 * so this page says so plainly rather than showing an empty grid that looks
 * like a fault.
 */
export default async function AuctionsPage() {
  const user = await currentUser();

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Floor
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate sm:text-4xl">Auctions</h1>
        </div>

        <div className="rounded-sm border border-sand-line bg-sand-raised p-8">
          <p className="font-display text-xl text-slate">No auctions are running yet.</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-dim">
            Timed auctions open once there is enough stock to fill a sale worth attending. They
            will run with a hidden reserve, proxy bidding up to your maximum, and anti-sniping —
            a bid in the closing minutes extends the clock, so a lot is won by the highest
            bidder rather than the fastest connection.
          </p>
          <a
            href="/browse"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
          >
            Buy at a fixed price instead
          </a>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
