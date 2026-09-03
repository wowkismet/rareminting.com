import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import {
  CategoryDonut,
  Panel,
  QuickActions,
  SalesChart,
  StatCard,
} from '@/components/DashboardPanels.tsx';
import { ItemRow } from '@/components/ItemRow.tsx';
import { loadSeller, rupees, sellerMenu, STATE_LABEL } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'Seller dashboard' };
export const dynamic = 'force-dynamic';

const ORDER_TONE: Record<string, string> = {
  payment_pending: 'text-ember',
  paid: 'text-accent-deep',
  shipped: 'text-accent-deep',
  delivered: 'text-accent-deep',
  completed: 'text-slate-dim',
  cancelled: 'text-slate-dim',
};

/**
 * The seller's console.
 *
 * One request draws the whole thing — the counts, the thirty-day series, the
 * recent orders, the best sellers and the payout balances all come back
 * together, so the page a seller opens most does not assemble itself through a
 * waterfall of round trips.
 */
export default async function SellerDashboardPage() {
  const { user, data } = await loadSeller();
  const { seller, stats, listings, salesSeries, recentOrders, topListings, payouts } = data;
  const needsPhotos = listings.filter((l) => l.photoCount === 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Seller dashboard"
      subtitle={`Manage your listings, orders and payouts · ${seller.displayName}`}
      sections={sellerMenu(data)}
      current="/seller"
      action={{ href: '/sell', label: 'Add new listing' }}
    >
      <div className="flex flex-col gap-6">
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

        {/* Headline figures */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total sales"
            value={rupees(stats.sales.grossInr)}
            hint="payments that have cleared"
            accent
          />
          <StatCard label="Total orders" value={String(stats.sales.orders)} hint="all time" />
          <StatCard
            label="Active listings"
            value={String(stats.listings.live)}
            hint={`${stats.listings.draft} draft${stats.listings.draft === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Pending orders"
            value={String(stats.sales.awaitingPayment + stats.sales.awaitingDispatch)}
            hint="awaiting payment or dispatch"
          />
        </div>

        {/* Chart and category split */}
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Panel title="Sales overview">
            <SalesChart series={salesSeries} />
          </Panel>

          <Panel title="Listings by kind">
            <CategoryDonut
              slices={[
                { label: 'Banknotes', value: stats.byKind.notes, colour: '#1a4a2e' },
                { label: 'Coins', value: stats.byKind.coins, colour: '#c9a84c' },
                { label: 'Other collectibles', value: stats.byKind.other, colour: '#1a4a46' },
              ]}
            />
          </Panel>
        </div>

        {/* Orders, best sellers, money */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Recent orders" action={{ href: '/orders', label: 'View all' }}>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-slate-dim">No orders yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {recentOrders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3">
                    {o.imageUrl !== null ? (
                      <img
                        src={o.imageUrl}
                        alt=""
                        className="h-10 w-14 shrink-0 rounded-sm border border-sand-line object-cover"
                      />
                    ) : (
                      <div className="h-10 w-14 shrink-0 rounded-sm border border-dashed border-sand-line" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/orders/${o.id}`}
                        className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                      >
                        {o.orderNumber}
                      </a>
                      <p className="mt-0.5 text-xs text-slate-dim">{rupees(o.totalInr)}</p>
                    </div>
                    <span
                      className={`text-[10px] uppercase tracking-wider ${ORDER_TONE[o.state] ?? 'text-slate-dim'}`}
                    >
                      {o.state.replace(/_/g, ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Most looked at" action={{ href: '/seller/items', label: 'View all' }}>
            {topListings.length === 0 ? (
              <p className="text-sm text-slate-dim">Nothing listed yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {topListings.map((l) => (
                  <li key={l.id} className="flex items-center gap-3">
                    {l.imageUrl !== null ? (
                      <img
                        src={l.imageUrl}
                        alt=""
                        className="h-10 w-14 shrink-0 rounded-sm border border-sand-line object-cover"
                      />
                    ) : (
                      <div className="h-10 w-14 shrink-0 rounded-sm border border-dashed border-sand-line" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/listing/${l.id}`}
                        className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                      >
                        {l.serialDigits ?? l.title}
                      </a>
                      <p className="mt-0.5 text-xs text-slate-dim">
                        {l.priceInr === null ? '—' : rupees(l.priceInr)} · {l.views} view
                        {l.views === 1 ? '' : 's'}
                        {l.sold > 0 && ` · ${l.sold} sold`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Payments" action={{ href: '/seller/payouts', label: 'View details' }}>
            <div className="guilloche rounded-sm border border-line bg-primary p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream-dim">
                Ready to request
              </p>
              <p className="mt-2 font-display text-2xl tabular-nums text-accent-bright">
                {rupees(payouts.availableInr)}
              </p>
              <a
                href="/seller/payouts"
                className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-xs font-medium text-ink transition-colors hover:bg-accent-bright"
              >
                Withdraw funds
              </a>
            </div>

            <dl className="mt-4 flex flex-col gap-2 text-sm">
              {(
                [
                  ['Cleared to you', rupees(stats.sales.payoutInr)],
                  ['Already paid out', rupees(payouts.paidInr)],
                  ['Requested', rupees(payouts.requestedInr)],
                  ['On hold', rupees(payouts.onHoldInr)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-dim">{label}</dt>
                  <dd className="tabular-nums text-slate">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <QuickActions
          actions={[
            { href: '/sell', label: 'Add listing', icon: '＋' },
            { href: '/seller/items', label: 'My items', icon: '▤' },
            { href: '/sell?mode=auction', label: 'New auction', icon: '⚖' },
            { href: '/orders', label: 'Orders', icon: '▦' },
            { href: '/seller/payouts', label: 'Payouts', icon: '₹' },
            { href: '/contact', label: 'Support', icon: '☎' },
          ]}
        />

        {needsPhotos.length > 0 && (
          <div className="rounded-sm border border-accent-deep/40 bg-accent-deep/5 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
              Add photographs
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              {needsPhotos.length} of your {listings.length} listing
              {listings.length === 1 ? '' : 's'} {needsPhotos.length === 1 ? 'has' : 'have'} no
              photograph. Buyers decide on the picture —{' '}
              <a href="/seller/photos" className="text-accent-deep underline underline-offset-4">
                add them here
              </a>
              .
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

        {/* Deliberately absent: a store rating. There is no reviews system yet,
            so any number here would be invented. */}
        <p className="text-xs text-slate-dim">
          Ratings and reviews are not built yet, so no store rating is shown. {STATE_LABEL['minted']}{' '}
          listings are visible to buyers.
        </p>
      </div>
    </DashboardShell>
  );
}
