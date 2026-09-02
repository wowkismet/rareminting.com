import type { Metadata } from 'next';

import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { ItemRow } from '@/components/ItemRow.tsx';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'Seller dashboard' };
export const dynamic = 'force-dynamic';

/**
 * The seller's own page.
 *
 * One request to /v1/sellers/me/dashboard draws the whole thing, so the page
 * does not fan out into a waterfall on the view a seller opens most.
 */

export default async function SellerDashboardPage() {
  const { user, data } = await loadSeller();
  const { seller, stats, listings } = data;
  const needsPhotos = listings.filter((l) => l.photoCount === 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Seller dashboard"
      subtitle={`Selling as ${seller.displayName}`}
      sections={sellerMenu(data)}
      current="/seller"
      action={{ href: '/sell', label: 'List something new' }}
    >
      <div className="flex flex-col gap-10">
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
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-xl text-slate">Recent items</h2>
            {listings.length > 5 && (
              <a href="/seller/items" className="text-sm text-accent-deep underline underline-offset-4">
                See all {listings.length}
              </a>
            )}
          </div>

          {listings.length === 0 ? (
            <Empty action={{ href: '/sell', label: 'List your first item' }}>
              Nothing listed yet. Your items appear here with their photographs, views and status.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {listings.slice(0, 5).map((l) => (
                <ItemRow key={l.id} listing={l} canPublish={seller.approved} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
