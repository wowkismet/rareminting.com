import type { Metadata } from 'next';

import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

/**
 * What the seller is owed, and what has actually cleared.
 *
 * The distinction is the whole point of the page. A buyer committing to an
 * order is not the same as money arriving, and a seller who confuses the two
 * will believe they have been paid when they have not.
 */
export default async function SellerPayoutsPage() {
  const { user, data } = await loadSeller();
  const { sales } = data.stats;
  const deductions = sales.grossInr - sales.payoutInr;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Payouts"
      subtitle="What you have earned, and what is still in flight"
      sections={sellerMenu(data)}
      current="/seller/payouts"
    >
      <div className="flex flex-col gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Tile
            label="Cleared to you"
            value={rupees(sales.payoutInr)}
            hint="after commission, GST on it, and TDS"
            accent
          />
          <Tile
            label="Committed by buyers"
            value={rupees(sales.committedInr)}
            hint="includes orders awaiting payment — not yet yours"
          />
        </div>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">How a sale breaks down</h2>
          {sales.grossInr === 0 ? (
            <Empty action={{ href: '/seller/items', label: 'See your items' }}>
              No payment has cleared yet, so there is nothing to break down. Once a buyer pays, this
              shows exactly what was deducted and what reached you.
            </Empty>
          ) : (
            <dl className="overflow-hidden rounded-sm border border-sand-line">
              <div className="flex items-baseline justify-between gap-4 bg-sand-raised px-5 py-3">
                <dt className="text-sm text-slate-dim">Buyers paid, for the items</dt>
                <dd className="font-mono tabular-nums text-slate">{rupees(sales.grossInr)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-sand-line bg-sand-raised px-5 py-3">
                <dt className="text-sm text-slate-dim">
                  Less commission, GST on commission, and TDS
                </dt>
                <dd className="font-mono tabular-nums text-ember">−{rupees(deductions)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-sand-line bg-sand-raised px-5 py-4">
                <dt className="font-display text-lg text-slate">Reaching you</dt>
                <dd className="font-display text-xl tabular-nums text-accent-deep">
                  {rupees(sales.payoutInr)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Where your orders are</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Orders" value={String(sales.orders)} />
            <Tile
              label="Awaiting payment"
              value={String(sales.awaitingPayment)}
              alert={sales.awaitingPayment > 0}
            />
            <Tile label="To dispatch" value={String(sales.awaitingDispatch)} />
            <Tile label="Completed" value={String(sales.completed)} />
          </div>
        </section>

        <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent-deep">
            Payments are not switched on yet
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-dim">
            No payment gateway is connected, so orders stop at &ldquo;awaiting payment&rdquo; and no
            money moves in either direction. Nothing here is lost — the orders are real and will
            settle once the gateway is live.
          </p>
        </div>

        <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-dim">
            When you get paid
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-dim">
            Your money is held until the buyer receives the item and the inspection window closes.
            That window is what protects them, and it is also what lets buyers trust an unfamiliar
            seller enough to buy at all. See{' '}
            <a href="/refunds" className="text-accent-deep underline underline-offset-4">
              refunds and cancellations
            </a>
            .
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
