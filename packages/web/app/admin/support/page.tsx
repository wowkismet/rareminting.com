import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { COMPANY } from '@rareminting/config';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Support tickets',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Overview {
  alerts: { disputesOpen: number };
}

/**
 * Support, such as it is.
 *
 * There is no ticketing system — no table, no threads, no queue. Rather than
 * show an invented count, this page says where support actually arrives today
 * and points at the one queue that genuinely exists: disputes, which are the
 * complaints that carry money and a deadline.
 */
export default async function AdminSupportPage() {
  const { user, token, sections } = await loadAdmin();
  const overview = await api<Overview>('/v1/admin/overview', { token });
  const disputes = overview.ok ? overview.data.alerts.disputesOpen : 0;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Support tickets"
      subtitle="No ticketing system yet"
      sections={sections}
      current="/admin/support"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Open disputes"
            value={String(disputes)}
            hint="the one queue that exists"
            accent
          />
          <StatCard label="Support tickets" value="—" hint="no ticketing system" />
        </div>

        <Panel title="Where support arrives today">
          <dl className="flex flex-col gap-4 text-sm">
            <div>
              <dt className="text-slate">Email</dt>
              <dd className="mt-1 text-slate-dim">
                Messages go to{' '}
                <span className="font-mono text-accent-deep">
                  {COMPANY.grievanceOfficer?.email ?? 'the grievance address'}
                </span>{' '}
                and are handled in an inbox, not here. Nothing on this site reads that mailbox, so a
                &ldquo;0 open tickets&rdquo; figure would mean only that nobody had counted.
              </dd>
            </div>
            <div>
              <dt className="text-slate">Disputes</dt>
              <dd className="mt-1 text-slate-dim">
                A complaint attached to an order — wrong serial, condition, damage, non-delivery,
                authenticity — is a dispute rather than a ticket. It carries money and an evidence
                deadline, and lives with the order it belongs to.{' '}
                <a
                  href="/admin/orders"
                  className="text-accent-deep underline underline-offset-4"
                >
                  See orders in dispute
                </a>
                .
              </dd>
            </div>
          </dl>
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          A ticketing system is a real piece of work rather than a page: threads, assignment, status,
          and a decision about whether buyers and sellers may message each other directly. That last
          part is the reason to think before building it — direct messaging between strangers around
          a payment is where marketplaces get taken off-platform and defrauded.
        </p>
      </div>
    </DashboardShell>
  );
}
