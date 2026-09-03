import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';
import { SellerTable, type AdminSeller } from '@/components/SellerTable.tsx';

export const metadata: Metadata = {
  title: 'KYC verification',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * The queue, oldest first.
 *
 * The same table as the sellers page, narrowed to those still waiting. A
 * seller left in this queue cannot publish or be paid, so the age of the
 * oldest entry is the number worth watching.
 */
export default async function AdminKycPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ sellers: AdminSeller[] }>('/v1/admin/sellers', { token });
  const all = result.ok ? result.data.sellers : [];

  const waiting = all.filter((s) => ['pending', 'under_review'].includes(s.kycState));
  const verified = all.filter((s) => s.kycState === 'verified').length;
  const rejected = all.filter((s) => s.kycState === 'rejected').length;

  const oldest = waiting.at(0)?.createdAt ?? null;
  const waitingDays =
    oldest === null
      ? null
      : Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000);

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="KYC verification"
      subtitle={
        waiting.length === 0
          ? 'Nothing waiting on a decision'
          : `${waiting.length} waiting on a decision`
      }
      sections={sections}
      current="/admin/kyc"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Waiting" value={String(waiting.length)} accent />
          <StatCard
            label="Longest wait"
            value={waitingDays === null ? '—' : `${waitingDays}d`}
            hint={waitingDays === null ? 'queue is empty' : 'since they registered'}
          />
          <StatCard label="Verified" value={String(verified)} />
          <StatCard label="Rejected" value={String(rejected)} />
        </div>

        <Panel title="Waiting on a decision">
          <SellerTable
            sellers={waiting}
            emptyMessage="Nobody is waiting. New registrations appear here."
          />
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          PAN and Aadhaar numbers are not stored anywhere — they were turned into a one-way
          fingerprint at registration. The last four characters shown are enough to check against a
          card a seller reads out, and are all that exists to show.
        </p>
      </div>
    </DashboardShell>
  );
}
