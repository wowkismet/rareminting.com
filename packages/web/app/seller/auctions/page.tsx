import type { Metadata } from 'next';

import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { ItemRow } from '@/components/ItemRow.tsx';
import { loadSeller, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'My auctions' };
export const dynamic = 'force-dynamic';

/**
 * The seller's own lots.
 *
 * Auctions behave differently enough from a fixed price to deserve their own
 * page: they close on a deadline the seller did not choose the moment of, and
 * a lot with no bids two hours from closing is something to act on rather than
 * a row in a longer list.
 */
export default async function SellerAuctionsPage() {
  const { user, data } = await loadSeller();
  const lots = data.listings.filter((l) => l.saleMode === 'auction');
  const { auctions } = data.stats;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="My auctions"
      subtitle={
        lots.length === 0
          ? 'Nothing under the hammer'
          : `${lots.length} lot${lots.length === 1 ? '' : 's'} · ${auctions.bids} bid${auctions.bids === 1 ? '' : 's'} received`
      }
      sections={sellerMenu(data)}
      current="/seller/auctions"
      action={{ href: '/sell?mode=auction', label: 'List for auction' }}
    >
      <div className="flex flex-col gap-10">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile label="Live now" value={String(auctions.live)} accent />
          <Tile label="Scheduled" value={String(auctions.scheduled)} />
          <Tile label="Ended" value={String(auctions.ended)} />
          <Tile label="Bids received" value={String(auctions.bids)} />
        </div>

        <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
            How your lots are bid on
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-dim">
            Bidders state the most they will pay and we bid on their behalf only as far as we must,
            so a lot is usually won below the top bidder&rsquo;s ceiling — and a bid in the final
            two minutes pushes the close out, so nobody wins by having the fastest connection. You
            cannot bid on your own lot, and a reserve is reported to bidders as met or not, never
            as a figure.
          </p>
        </div>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Your lots</h2>

          {lots.length === 0 ? (
            <Empty action={{ href: '/sell?mode=auction', label: 'List something for auction' }}>
              You have no auction lots. Any item can be sold by auction instead of at a fixed
              price — choose it when you list, or convert a draft from your items.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {lots.map((l) => (
                <ItemRow key={l.id} listing={l} canPublish={data.seller.approved} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
