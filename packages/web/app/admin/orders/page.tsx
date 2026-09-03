import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin, rupees } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AdminOrder {
  id: string;
  orderNumber: string;
  state: string;
  totalInr: number;
  buyer: string;
  seller: string;
  title: string | null;
  createdAt: string;
}

const TONE: Record<string, string> = {
  payment_pending: 'text-ember',
  disputed: 'text-ember',
  cancelled: 'text-slate-dim',
  refunded: 'text-slate-dim',
  completed: 'text-slate-dim',
};

/**
 * Every order, both sides named.
 *
 * Money in and money out are counted apart: an order exists when a buyer
 * commits, but the money is only real once payment clears, and folding the two
 * together would report income that has not arrived.
 */
export default async function AdminOrdersPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ orders: AdminOrder[] }>('/v1/admin/orders', { token });
  const orders = result.ok ? result.data.orders : [];

  const PAID = ['paid', 'packed', 'shipped', 'delivered', 'inspection', 'completed', 'disputed'];
  const cleared = orders
    .filter((o) => PAID.includes(o.state))
    .reduce((sum, o) => sum + o.totalInr, 0);
  const awaiting = orders.filter((o) => ['created', 'payment_pending'].includes(o.state)).length;
  const disputed = orders.filter((o) => o.state === 'disputed').length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Orders"
      subtitle={`${orders.length} order${orders.length === 1 ? '' : 's'}`}
      sections={sections}
      current="/admin/orders"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Orders" value={String(orders.length)} />
          <StatCard
            label="Payment cleared"
            value={rupees(cleared)}
            hint="money that actually arrived"
            accent
          />
          <StatCard label="Awaiting payment" value={String(awaiting)} />
          <StatCard label="In dispute" value={String(disputed)} />
        </div>

        <Panel title="Every order">
          {orders.length === 0 ? (
            <p className="text-sm text-slate-dim">No orders yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Order</th>
                    <th className="border-b border-sand-line p-3">Item</th>
                    <th className="border-b border-sand-line p-3">Buyer</th>
                    <th className="border-b border-sand-line p-3">Seller</th>
                    <th className="border-b border-sand-line p-3">Total</th>
                    <th className="border-b border-sand-line p-3">State</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="border-b border-sand-line p-3">
                        <a
                          href={`/orders/${o.id}`}
                          className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                        >
                          {o.orderNumber}
                        </a>
                        <span className="mt-0.5 block text-[10px] text-slate-dim">
                          {o.createdAt.slice(0, 10)}
                        </span>
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        {o.title ?? '—'}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {o.buyer}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {o.seller}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate">
                        {rupees(o.totalInr)}
                      </td>
                      <td
                        className={`border-b border-sand-line p-3 text-[10px] uppercase tracking-wider ${TONE[o.state] ?? 'text-accent-deep'}`}
                      >
                        {o.state.replace(/_/g, ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}
