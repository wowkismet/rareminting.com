import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { publishListing } from '@/app/actions.ts';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Seller dashboard' };
export const dynamic = 'force-dynamic';

/**
 * The seller's own page.
 *
 * One request to /v1/sellers/me/dashboard draws the whole thing, so the page
 * does not fan out into a waterfall on the view a seller opens most.
 */

interface Dashboard {
  seller: { displayName: string; kycState: string; approved: boolean };
  stats: {
    listings: {
      total: number;
      draft: number;
      inReview: number;
      live: number;
      reserved: number;
      sold: number;
      withdrawn: number;
    };
    byKind: { notes: number; coins: number; other: number };
    views: number;
    sales: {
      orders: number;
      completed: number;
      awaitingPayment: number;
      awaitingDispatch: number;
      grossInr: number;
      payoutInr: number;
      committedInr: number;
    };
    auctions: { live: number; scheduled: number; ended: number; bids: number };
  };
  listings: {
    id: string;
    title: string;
    state: string;
    kind: string;
    priceInr: number | null;
    grade: string | null;
    views: number;
    photoCount: number;
    imageUrl: string | null;
    serialDigits: string | null;
    denomination: number | null;
    createdAt: string;
  }[];
}

const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  minted: 'Live',
  reserved: 'Reserved',
  struck: 'Sold',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
};

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

function Tile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-sm border border-sand-line bg-sand-raised p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">{label}</p>
      <p
        className={`mt-2 font-display text-3xl tabular-nums ${accent ? 'text-accent-deep' : 'text-slate'}`}
      >
        {value}
      </p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-dim">{hint}</p>}
    </div>
  );
}

export default async function SellerDashboardPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const result = await api<Dashboard>('/v1/sellers/me/dashboard', { token });

  // Not a seller yet — send them to the one page that can fix that.
  if (!result.ok) redirect('/sell');

  const { seller, stats, listings } = result.data;
  const needsPhotos = listings.filter((l) => l.photoCount === 0);

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
              The Mint
            </p>
            <h1 className="mt-2 font-display text-3xl text-slate">Seller dashboard</h1>
            <p className="mt-2 text-sm text-slate-dim">
              Selling as <span className="text-slate">{seller.displayName}</span>
            </p>
          </div>
          <a
            href="/sell"
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
          >
            List something new
          </a>
        </div>

        {!seller.approved && (
          <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
              {seller.kycState === 'rejected' ? 'Not approved' : 'Awaiting approval'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              {seller.kycState === 'rejected'
                ? 'Your seller account was not approved. Contact us and we will tell you what to fix.'
                : 'An admin is checking your details. Everything below still works — prepare listings and add photographs now, and publish the moment you are approved.'}
            </p>
          </div>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Listings</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="Total listed" value={String(stats.listings.total)} />
            <Tile label="Live now" value={String(stats.listings.live)} accent />
            <Tile label="Drafts" value={String(stats.listings.draft)} hint="not yet published" />
            <Tile label="Sold" value={String(stats.listings.sold)} />
            <Tile label="Views" value={stats.views.toLocaleString('en-IN')} hint="excludes your own" />
          </div>
          <p className="mt-3 text-xs text-slate-dim">
            {stats.byKind.notes} banknote{stats.byKind.notes === 1 ? '' : 's'} ·{' '}
            {stats.byKind.coins} coin{stats.byKind.coins === 1 ? '' : 's'} · {stats.byKind.other}{' '}
            other collectible{stats.byKind.other === 1 ? '' : 's'}
          </p>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Sales</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Orders" value={String(stats.sales.orders)} />
            <Tile
              label="Awaiting payment"
              value={String(stats.sales.awaitingPayment)}
              hint={stats.sales.awaitingPayment > 0 ? 'gateway not live yet' : undefined}
            />
            <Tile label="To dispatch" value={String(stats.sales.awaitingDispatch)} />
            <Tile label="Completed" value={String(stats.sales.completed)} />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Tile
              label="Your payout"
              value={rupees(stats.sales.payoutInr)}
              hint="after commission, GST and TDS — on payments that have cleared"
              accent
            />
            <Tile
              label="Committed by buyers"
              value={rupees(stats.sales.committedInr)}
              hint="includes orders still awaiting payment; not yet earned"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Auctions</h2>
          {stats.auctions.live + stats.auctions.scheduled + stats.auctions.ended === 0 ? (
            <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
              You have no auction lots. Auctions are not open for listing yet — every item is sold
              at a fixed price or by offer for now.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Tile label="Live" value={String(stats.auctions.live)} accent />
              <Tile label="Scheduled" value={String(stats.auctions.scheduled)} />
              <Tile label="Ended" value={String(stats.auctions.ended)} />
              <Tile label="Bids received" value={String(stats.auctions.bids)} />
            </div>
          )}
        </section>

        {needsPhotos.length > 0 && (
          <div className="rounded-sm border border-accent-deep/40 bg-accent-deep/5 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
              Add photographs
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              {needsPhotos.length} of your {listings.length} listing
              {listings.length === 1 ? '' : 's'} {needsPhotos.length === 1 ? 'has' : 'have'} no
              photograph. Buyers decide on the picture — open a listing below and use{' '}
              <span className="text-slate">Add a photograph</span>.
            </p>
          </div>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Your items</h2>

          {listings.length === 0 ? (
            <div className="rounded-sm border border-sand-line bg-sand-raised p-6">
              <p className="text-sm text-slate-dim">
                Nothing listed yet. Add your first item and it appears here with its photographs,
                views and status.
              </p>
              <a
                href="/sell"
                className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                List your first item
              </a>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {listings.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                >
                  {l.imageUrl !== null ? (
                    <img
                      src={l.imageUrl}
                      alt={l.title}
                      className="h-16 w-24 shrink-0 rounded-sm border border-sand-line object-cover"
                    />
                  ) : (
                    <a
                      href={`/listing/${l.id}`}
                      className="flex h-16 w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-accent-deep/50 text-center text-[10px] leading-tight text-accent-deep"
                    >
                      Add a
                      <br />
                      photo
                    </a>
                  )}

                  <div className="min-w-0 flex-1">
                    <a
                      href={`/listing/${l.id}`}
                      className="font-mono text-sm text-slate underline-offset-4 hover:underline"
                    >
                      {l.serialDigits ?? l.title}
                    </a>
                    <p className="mt-1 text-xs text-slate-dim">
                      {l.denomination !== null && `₹${l.denomination} · `}
                      {l.grade ?? 'ungraded'}
                      {l.priceInr !== null && ` · ${rupees(l.priceInr)}`}
                      {' · '}
                      {l.views} view{l.views === 1 ? '' : 's'}
                      {' · '}
                      {l.photoCount} photo{l.photoCount === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                      {STATE_LABEL[l.state] ?? l.state}
                    </span>
                    {l.state === 'draft' && seller.approved && (
                      <form action={publishListing}>
                        <input type="hidden" name="id" value={l.id} />
                        <button
                          type="submit"
                          className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                        >
                          Publish
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
