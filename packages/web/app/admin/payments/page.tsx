import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, QuickActions, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { adminMenu, rupees } from '@/lib/admin-dashboard.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Payments & payouts',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Overview {
  kpis: { totalGmvInr: number; totalRevenueInr: number; totalOrders: number };
  alerts: { pendingPayoutsInr: number; paidPayoutsInr: number; kycPending: number; disputesOpen: number };
}

/**
 * Money in and money out, side by side.
 *
 * The two are counted apart deliberately. What buyers paid is not what sellers
 * are owed, and neither is what the platform keeps — commission, GST on that
 * commission and TDS all sit between them, and a single "revenue" figure would
 * hide all three.
 */
export default async function AdminPaymentsPage() {
  const user = await currentUser();
  const token = await sessionToken();

  const overview = await api<Overview>('/v1/admin/overview', { token });
  if (!overview.ok) notFound();
  const o = overview.data;

  const owed = o.alerts.pendingPayoutsInr;
  const paid = o.alerts.paidPayoutsInr;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Payments & payouts"
      subtitle={owed === 0 ? 'Nothing owed to sellers' : `${rupees(owed)} owed to sellers`}
      sections={adminMenu({ kycPending: o.alerts.kycPending, disputesOpen: o.alerts.disputesOpen })}
      current="/admin/payments"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Taken from buyers"
            value={rupees(o.kpis.totalGmvInr)}
            hint="across every order"
          />
          <StatCard
            label="Kept by the platform"
            value={rupees(o.kpis.totalRevenueInr)}
            hint="commission and GST on it"
            accent
          />
          <StatCard label="Owed to sellers" value={rupees(owed)} hint="awaiting transfer" />
          <StatCard label="Already paid out" value={rupees(paid)} />
        </div>

        <Panel title="Where each of these lives">
          <dl className="flex flex-col gap-4 text-sm">
            <div>
              <dt className="text-slate">Money in</dt>
              <dd className="mt-1 text-slate-dim">
                Every payment attempt, with the gateway&rsquo;s own reference for tracing one —{' '}
                <a
                  href="/admin/transactions"
                  className="text-accent-deep underline underline-offset-4"
                >
                  transactions
                </a>
                .
              </dd>
            </div>
            <div>
              <dt className="text-slate">Money out</dt>
              <dd className="mt-1 text-slate-dim">
                The transfer queue, where a payout is held, released or recorded against its bank
                reference —{' '}
                <a href="/admin/payouts" className="text-accent-deep underline underline-offset-4">
                  payouts
                </a>
                . Revealing an account number is audited.
              </dd>
            </div>
            <div>
              <dt className="text-slate">What sits between</dt>
              <dd className="mt-1 text-slate-dim">
                Commission is 20% of the sale price. GST on that commission and TDS under section
                194-O are deducted as the law requires, which is why what a seller receives is
                smaller than what their buyer paid.
              </dd>
            </div>
          </dl>
        </Panel>

        <QuickActions
          actions={[
            { href: '/admin/payouts', label: 'Transfer queue', icon: '₹' },
            { href: '/admin/transactions', label: 'Transactions', icon: '▤' },
            { href: '/admin/orders', label: 'Orders', icon: '▦' },
          ]}
        />
      </div>
    </DashboardShell>
  );
}
