import type { Metadata } from 'next';

import { moderateListing } from '@/app/actions.ts';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin, rupees } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Products & listings',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AdminListing {
  id: string;
  title: string;
  state: string;
  priceInr: number | null;
  grade: string | null;
  sellerName: string;
  serialDigits: string | null;
  createdAt: string;
}

/**
 * The moderation list.
 *
 * Withdrawing is the only action here, and it is deliberately one-way from
 * this page: putting something back on the market is the seller's decision to
 * make, not staff's.
 */
export default async function AdminProductsPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ listings: AdminListing[] }>('/v1/admin/listings', { token });
  const listings = result.ok ? result.data.listings : [];

  const live = listings.filter((l) => l.state === 'minted').length;
  const drafts = listings.filter((l) => l.state === 'draft').length;
  const withdrawn = listings.filter((l) => l.state === 'withdrawn').length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Products & listings"
      subtitle={`${listings.length} listing${listings.length === 1 ? '' : 's'} on the floor`}
      sections={sections}
      current="/admin/products"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={String(listings.length)} />
          <StatCard label="Live" value={String(live)} accent />
          <StatCard label="Draft" value={String(drafts)} />
          <StatCard label="Withdrawn" value={String(withdrawn)} />
        </div>

        <Panel title="Listings">
          {listings.length === 0 ? (
            <p className="text-sm text-slate-dim">Nothing listed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Serial</th>
                    <th className="border-b border-sand-line p-3">Seller</th>
                    <th className="border-b border-sand-line p-3">Price</th>
                    <th className="border-b border-sand-line p-3">Grade</th>
                    <th className="border-b border-sand-line p-3">State</th>
                    <th className="border-b border-sand-line p-3">Moderate</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id}>
                      <td className="border-b border-sand-line p-3">
                        <a
                          href={`/listing/${l.id}`}
                          className="font-mono text-slate underline-offset-4 hover:underline"
                        >
                          {l.serialDigits ?? l.title}
                        </a>
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        {l.sellerName}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                        {l.priceInr === null ? '—' : rupees(l.priceInr)}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">
                        {l.grade ?? '—'}
                      </td>
                      <td className="border-b border-sand-line p-3 text-slate-dim">{l.state}</td>
                      <td className="border-b border-sand-line p-3">
                        {l.state !== 'withdrawn' && (
                          <form action={moderateListing}>
                            <input type="hidden" name="listingId" value={l.id} />
                            <input type="hidden" name="state" value="withdrawn" />
                            <button
                              type="submit"
                              className="rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                            >
                              Withdraw
                            </button>
                          </form>
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
