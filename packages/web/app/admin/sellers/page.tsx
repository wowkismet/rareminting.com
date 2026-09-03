import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { SellerTable, type AdminSeller } from '@/components/SellerTable.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Sellers',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Every seller, and the two decisions an admin makes about them.
 *
 * Approval is what lets somebody publish and be paid, so it lives on a page of
 * its own rather than folded into the overview, where it had ended up below
 * three screens of charts.
 */
export default async function AdminSellersPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ sellers: AdminSeller[] }>('/v1/admin/sellers', { token });
  const sellers = result.ok ? result.data.sellers : [];

  const waiting = sellers.filter((s) => ['pending', 'under_review'].includes(s.kycState));
  const verified = sellers.filter((s) => s.kycState === 'verified').length;
  const listings = sellers.reduce((sum, s) => sum + s.listingCount, 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Sellers"
      subtitle={
        waiting.length === 0
          ? `${sellers.length} registered · nothing waiting on a decision`
          : `${waiting.length} waiting on a decision`
      }
      sections={sections}
      current="/admin/sellers"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sellers" value={String(sellers.length)} />
          <StatCard
            label="Waiting"
            value={String(waiting.length)}
            hint="cannot publish until decided"
            accent
          />
          <StatCard label="Verified" value={String(verified)} />
          <StatCard label="Listings between them" value={String(listings)} />
        </div>

        <Panel title="Every seller">
          <SellerTable sellers={sellers} emptyMessage="No sellers registered yet." />
        </Panel>
      </div>
    </DashboardShell>
  );
}
