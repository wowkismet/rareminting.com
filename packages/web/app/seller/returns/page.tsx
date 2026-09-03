import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';
import { sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Returns and claims' };
export const dynamic = 'force-dynamic';

interface Dispute {
  id: string;
  orderId: string;
  orderNumber: string;
  reasonCode: string;
  description: string | null;
  state: string;
  refundInr: number | null;
  evidenceDueAt: string | null;
  createdAt: string;
}

const REASON: Record<string, string> = {
  not_as_described: 'Not as described',
  wrong_serial: 'Wrong serial number',
  not_authentic: 'Authenticity questioned',
  damaged: 'Arrived damaged',
  not_received: 'Never arrived',
  wrong_item: 'Wrong item sent',
};

/**
 * Claims raised against this seller's orders.
 *
 * Each shows its deadline, because a claim left unanswered is decided without
 * the seller — the most expensive thing that can happen quietly on this page.
 */
export default async function SellerReturnsPage() {
  const { user, data } = await loadSeller();
  const token = await sessionToken();
  const result = await api<{ disputes: Dispute[] }>('/v1/sellers/me/disputes', { token });
  const disputes = result.ok ? result.data.disputes : [];
  const open = disputes.filter(
    (d) => !['closed', 'resolved_buyer', 'resolved_seller'].includes(d.state),
  );

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Returns and claims"
      subtitle={open.length === 0 ? 'Nothing outstanding' : `${open.length} awaiting your response`}
      sections={sellerMenu(data)}
      current="/seller/returns"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Open claims" value={String(open.length)} accent />
          <StatCard label="All time" value={String(disputes.length)} />
          <StatCard
            label="Orders"
            value={String(data.stats.sales.orders)}
            hint="claims are raised against these"
          />
        </div>

        <Panel title="Claims">
          {disputes.length === 0 ? (
            <Empty action={{ href: '/refunds', label: 'Read the refund policy' }}>
              No claims have been raised against your orders. A buyer can raise one during the
              inspection window after delivery.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-4">
              {disputes.map((d) => (
                <li key={d.id} className="rounded-sm border border-sand-line bg-sand p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <a
                      href={`/orders/${d.orderId}`}
                      className="font-mono text-sm text-slate underline-offset-4 hover:underline"
                    >
                      {d.orderNumber}
                    </a>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                      {d.state.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate">{REASON[d.reasonCode] ?? d.reasonCode}</p>
                  {d.description !== null && (
                    <p className="mt-1 text-sm text-slate-dim">{d.description}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-dim">
                    Raised {d.createdAt.slice(0, 10)}
                    {d.refundInr !== null && ` · refund claimed ${rupees(d.refundInr)}`}
                  </p>
                  {d.evidenceDueAt !== null && (
                    <p className="mt-2 text-xs text-ember">
                      Respond by {d.evidenceDueAt.slice(0, 10)} — a claim you do not answer is
                      decided without you.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          A buyer may claim during the inspection window for a wrong serial, a condition materially
          worse than stated, damage, a wrong item, or non-delivery. Authenticity can be raised at
          any time. See{' '}
          <a href="/refunds" className="text-accent-deep underline underline-offset-4">
            refunds and cancellations
          </a>{' '}
          for what qualifies.
        </div>
      </div>
    </DashboardShell>
  );
}
