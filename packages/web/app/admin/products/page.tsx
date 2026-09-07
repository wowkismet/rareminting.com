import type { Metadata } from 'next';

import { editListing, moderateListing } from '@/app/actions.ts';

const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;
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
                        <div className="flex flex-col gap-2">
                          {/* Editing is a details element so the table stays
                              readable: a form on every row would bury the list
                              this page exists to be. */}
                          <details>
                            <summary className="cursor-pointer list-none rounded-full border border-sand-line px-3 py-1 text-center text-xs text-slate transition-colors hover:border-accent-deep">
                              Edit
                            </summary>
                            <form
                              action={editListing}
                              className="mt-2 flex w-56 flex-col gap-2 rounded-sm border border-sand-line bg-sand p-3"
                            >
                              <input type="hidden" name="listingId" value={l.id} />
                              <label className="flex flex-col gap-1">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                                  Title
                                </span>
                                <input
                                  name="title"
                                  defaultValue={l.title}
                                  className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs text-slate"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                                  Price ₹
                                </span>
                                <input
                                  name="priceInr"
                                  type="number"
                                  min="1"
                                  step="1"
                                  defaultValue={l.priceInr ?? ''}
                                  className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs tabular-nums text-slate"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                                  Grade
                                </span>
                                <select
                                  name="grade"
                                  defaultValue={l.grade ?? ''}
                                  className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs text-slate"
                                >
                                  <option value="">Leave as is</option>
                                  {GRADES.map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="submit"
                                className="rounded-full bg-primary px-3 py-1.5 text-xs text-cream transition-colors hover:bg-secondary"
                              >
                                Save changes
                              </button>
                              <span className="text-[10px] leading-snug text-slate-dim">
                                Every change is written to the audit log against your account.
                              </span>
                            </form>
                          </details>

                          {l.state !== 'withdrawn' && (
                            <form action={moderateListing}>
                              <input type="hidden" name="listingId" value={l.id} />
                              <input type="hidden" name="state" value="withdrawn" />
                              <button
                                type="submit"
                                className="w-full rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                              >
                                Withdraw
                              </button>
                            </form>
                          )}
                        </div>
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
