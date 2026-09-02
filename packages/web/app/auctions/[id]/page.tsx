import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';

import { placeBid } from '@/app/actions.ts';
import { ActionForm, Field } from '@/components/Forms.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Auction' };
export const dynamic = 'force-dynamic';

interface AuctionDetail {
  auction: {
    id: string;
    listingId: string;
    title: string;
    state: string;
    startingInr: number;
    currentInr: number;
    nextMinimumInr: number;
    bidCount: number;
    endsAt: string;
    hasReserve: boolean;
    reserveMet: boolean;
    extensionCount: number;
    antiSnipeSeconds: number;
    winnerId: string | null;
    winningInr: number | null;
    youAreWinning: boolean;
    yourMaxInr: number | null;
  };
  bids: { amountInr: number; placedAt: string; bidder: string }[];
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

function timeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'closing now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hours left`;
  return `${Math.floor(hours / 24)} days left`;
}

export default async function AuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const token = await sessionToken();

  const result = await api<AuctionDetail>(`/v1/auctions/${id}`, { token });
  if (!result.ok) notFound();

  const { auction, bids } = result.data;
  const open = auction.state === 'live' || auction.state === 'extended';

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            {open ? timeLeft(auction.endsAt) : 'Closed'}
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate">{auction.title}</h1>
          <p className="mt-2 text-sm text-slate-dim">
            <a
              href={`/listing/${auction.listingId}`}
              className="text-accent-deep underline underline-offset-4"
            >
              See the full description and photographs
            </a>
          </p>
        </div>

        <div className="guilloche rounded-sm border border-line bg-primary px-6 py-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            {auction.bidCount === 0 ? 'Starting at' : 'Current bid'}
          </p>
          <p className="mt-3 font-display text-4xl text-cream">{rupees(auction.currentInr)}</p>
          <p className="mt-3 text-xs text-cream-dim">
            {auction.bidCount} bid{auction.bidCount === 1 ? '' : 's'}
            {auction.hasReserve && (auction.reserveMet ? ' · reserve met' : ' · reserve not met')}
            {auction.extensionCount > 0 &&
              ` · extended ${auction.extensionCount} time${auction.extensionCount === 1 ? '' : 's'}`}
          </p>
        </div>

        {!open && (
          <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
            <p className="font-display text-lg text-slate">This auction has closed</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              {auction.winnerId === null
                ? auction.hasReserve && !auction.reserveMet
                  ? 'The reserve was not met, so the lot did not sell. It is back on the floor at a fixed price.'
                  : 'No bids were placed, so the lot did not sell.'
                : `It sold for ${rupees(auction.winningInr ?? auction.currentInr)}.`}
            </p>
          </div>
        )}

        {open && user === null && (
          <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
            <p className="text-sm text-slate-dim">
              <a href="/signin" className="text-accent-deep underline underline-offset-4">
                Sign in
              </a>{' '}
              to bid on this lot.
            </p>
          </div>
        )}

        {open && user !== null && (
          <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
            {auction.youAreWinning ? (
              <p className="mb-4 rounded-sm border border-accent-deep/50 bg-accent-deep/10 px-4 py-3 text-sm text-slate">
                You are winning at {rupees(auction.currentInr)}
                {auction.yourMaxInr !== null && ` · your maximum is ${rupees(auction.yourMaxInr)}`}.
              </p>
            ) : (
              <p className="mb-4 text-sm leading-relaxed text-slate-dim">
                State the most you are willing to pay. We bid for you in the smallest steps that
                keep you in front, so you often pay less than your maximum — and nobody, seller
                included, ever sees the number you put here.
              </p>
            )}

            <ActionForm action={placeBid} submitLabel="Place bid">
              <input type="hidden" name="auctionId" value={auction.id} />
              {/* One nonce per rendered form, so a resubmitted page cannot
                  place the same bid twice. */}
              <input type="hidden" name="nonce" value={randomUUID()} />
              <Field
                label="Your maximum, in rupees"
                name="maxInr"
                type="number"
                required
                placeholder={String(Math.ceil(auction.nextMinimumInr))}
                hint={`At least ${rupees(auction.nextMinimumInr)}. A bid in the last ${Math.round(
                  auction.antiSnipeSeconds / 60,
                )} minutes extends the auction.`}
              />
            </ActionForm>
          </div>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Bid history</h2>
          {bids.length === 0 ? (
            <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
              No bids yet. The first bid opens the lot at {rupees(auction.startingInr)}.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bids.map((b, i) => (
                <li
                  key={`${b.placedAt}-${i}`}
                  className="flex items-baseline justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised px-4 py-3 text-sm"
                >
                  <span className={b.bidder === 'You' ? 'text-accent-deep' : 'text-slate-dim'}>
                    {b.bidder}
                  </span>
                  <span className="font-mono tabular-nums text-slate">{rupees(b.amountInr)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-dim">
            Bidders are anonymous to one another, as they are in a saleroom.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
