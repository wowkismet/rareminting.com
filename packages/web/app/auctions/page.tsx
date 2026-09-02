import type { Metadata } from 'next';

import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Auctions',
  description: 'Timed auctions for the rarest notes on Rare Minting.',
  alternates: { canonical: '/auctions' },
};
export const dynamic = 'force-dynamic';

interface AuctionSummary {
  id: string;
  listingId: string;
  title: string;
  serialDigits: string | null;
  grade: string | null;
  imageUrl: string | null;
  currentInr: number;
  startingInr: number;
  bidCount: number;
  endsAt: string;
  hasReserve: boolean;
  reserveMet: boolean;
  extensionCount: number;
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * How long is left, in words.
 *
 * Rendered on the server, so it is right at the moment the page is built and
 * goes stale after that — which is why the exact closing time is shown next to
 * it. A live countdown would need client JavaScript and a clock the visitor
 * trusts; the server's time is the one that decides the auction.
 */
function timeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'closing now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr left`;
  return `${Math.floor(hours / 24)} days left`;
}

export default async function AuctionsPage() {
  const user = await currentUser();
  const result = await api<{ auctions: AuctionSummary[] }>('/v1/auctions');
  const auctions = result.ok ? result.data.auctions : [];

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Rostrum
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate sm:text-4xl">Auctions</h1>
          <p className="mt-3 max-w-2xl text-slate-dim">
            Timed auctions with proxy bidding: state the most you are willing to pay and we bid on
            your behalf only as far as we must. You usually pay less than your maximum.
          </p>
        </div>

        {auctions.length === 0 ? (
          <div className="rounded-sm border border-sand-line bg-sand-raised p-10 text-center">
            <p className="font-display text-2xl text-slate">No auctions are running.</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-dim">
              Nothing is under the hammer at the moment. Sellers can put any draft listing up for
              auction, so this fills as stock arrives.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                href="/browse"
                className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Buy at a fixed price
              </a>
              <a
                href="/sell"
                className="rounded-full border border-sand-line px-8 py-3 text-sm text-slate transition-colors hover:border-accent-deep"
              >
                Auction a note
              </a>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {auctions.map((a) => (
              <a
                key={a.id}
                href={`/auctions/${a.id}`}
                className="flex flex-col gap-3 rounded-sm border border-sand-line bg-sand-raised p-5 transition-colors hover:border-accent-deep/60"
              >
                {a.imageUrl !== null ? (
                  <img
                    src={a.imageUrl}
                    alt={a.title}
                    loading="lazy"
                    className="aspect-[2/1] w-full rounded-sm border border-sand-line object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/1] w-full items-center justify-center rounded-sm border border-dashed border-sand-line text-xs text-slate-dim">
                    No photograph yet
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-cream">
                    {timeLeft(a.endsAt)}
                  </span>
                  {a.extensionCount > 0 && (
                    <span className="rounded-full border border-accent-deep/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
                      Extended
                    </span>
                  )}
                </div>

                <p className="font-mono text-lg tracking-[0.12em] tabular-nums text-slate">
                  {a.serialDigits ?? a.title}
                </p>

                <dl className="mt-auto flex items-end justify-between gap-3">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                      {a.bidCount === 0 ? 'Starting at' : 'Current bid'}
                    </dt>
                    <dd className="font-display text-xl text-slate">{rupees(a.currentInr)}</dd>
                  </div>
                  <div className="text-right text-xs text-slate-dim">
                    <p>
                      {a.bidCount} bid{a.bidCount === 1 ? '' : 's'}
                    </p>
                    {a.hasReserve && (
                      <p className={a.reserveMet ? 'text-accent-deep' : undefined}>
                        {a.reserveMet ? 'Reserve met' : 'Reserve not met'}
                      </p>
                    )}
                  </div>
                </dl>
              </a>
            ))}
          </div>
        )}

        <div className="rounded-sm border border-sand-line bg-sand-raised p-6">
          <h2 className="font-display text-xl text-slate">How the bidding works</h2>
          <ul className="mt-4 flex list-none flex-col gap-3 p-0 text-sm leading-relaxed text-slate-dim">
            <li className="border-l-2 border-accent-deep/50 pl-4">
              <strong className="text-slate">You name your maximum, not your bid.</strong> We bid
              for you in the smallest steps that keep you in front, so you pay only what it takes to
              win — often well under your maximum.
            </li>
            <li className="border-l-2 border-accent-deep/50 pl-4">
              <strong className="text-slate">Nobody sees your maximum.</strong> Not other bidders,
              not the seller. Knowing it would tell a rival exactly what to bid.
            </li>
            <li className="border-l-2 border-accent-deep/50 pl-4">
              <strong className="text-slate">A late bid extends the auction.</strong> Bid in the
              last two minutes and the close moves out, so a lot is won by whoever values it most
              rather than whoever has the fastest connection.
            </li>
            <li className="border-l-2 border-accent-deep/50 pl-4">
              <strong className="text-slate">A reserve is a floor, not a secret target.</strong> We
              tell you whether it has been met, never what it is. Below it, the lot does not sell.
            </li>
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
