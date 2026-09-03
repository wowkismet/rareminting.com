import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin, rupees } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Transactions',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Transaction {
  id: string;
  orderNumber: string;
  gateway: string;
  gatewayPaymentId: string | null;
  method: string | null;
  amountInr: number;
  state: string;
  failureReason: string | null;
  createdAt: string;
}

const TONE: Record<string, string> = {
  captured: 'text-accent-deep',
  authorized: 'text-accent-deep',
  failed: 'text-ember',
  refunded: 'text-slate-dim',
  partially_refunded: 'text-slate-dim',
};

/**
 * Money in, as the gateway reported it.
 *
 * The gateway's own payment id is shown in full: it is the reference both
 * sides quote when a payment has to be traced, and a masked one would make
 * this page useless for the single thing it is for.
 */
export default async function AdminTransactionsPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ transactions: Transaction[] }>('/v1/admin/transactions', { token });
  const rows = result.ok ? result.data.transactions : [];

  const captured = rows.filter((t) => t.state === 'captured');
  const failed = rows.filter((t) => t.state === 'failed').length;
  const total = captured.reduce((sum, t) => sum + t.amountInr, 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Transactions"
      subtitle={`${rows.length} payment attempt${rows.length === 1 ? '' : 's'}`}
      sections={sections}
      current="/admin/transactions"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Captured" value={rupees(total)} hint="money that arrived" accent />
          <StatCard label="Successful" value={String(captured.length)} />
          <StatCard label="Failed" value={String(failed)} />
          <StatCard label="Attempts" value={String(rows.length)} />
        </div>

        <Panel title="Payments">
          {rows.length === 0 ? (
            <p className="text-sm text-slate-dim">
              No payments yet. Each attempt appears here with the gateway&rsquo;s own reference, so
              a payment can be traced without leaving the console.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">When</th>
                    <th className="border-b border-sand-line p-3">Order</th>
                    <th className="border-b border-sand-line p-3">Gateway reference</th>
                    <th className="border-b border-sand-line p-3">Method</th>
                    <th className="border-b border-sand-line p-3">Amount</th>
                    <th className="border-b border-sand-line p-3">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {t.createdAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="border-b border-sand-line p-3 font-mono text-xs text-slate">
                        {t.orderNumber}
                      </td>
                      <td className="border-b border-sand-line p-3 font-mono text-[11px] text-slate-dim">
                        {t.gatewayPaymentId ?? '—'}
                        <span className="ml-1 text-[10px] uppercase">{t.gateway}</span>
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {t.method ?? '—'}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate">
                        {rupees(t.amountInr)}
                      </td>
                      <td
                        className={`border-b border-sand-line p-3 text-[10px] uppercase tracking-wider ${TONE[t.state] ?? 'text-slate-dim'}`}
                      >
                        {t.state.replace(/_/g, ' ')}
                        {t.failureReason !== null && (
                          <span className="mt-0.5 block normal-case tracking-normal text-slate-dim">
                            {t.failureReason}
                          </span>
                        )}
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
