import type { Metadata } from 'next';

import { adminUploadPhoto, editListing, moderateListing } from '@/app/actions.ts';

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
  description: string | null;
  state: string;
  priceInr: number | null;
  grade: string | null;
  sellerId: string;
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
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ sellerId?: string }>;
}) {
  const { sellerId } = await searchParams;
  const { user, token, sections } = await loadAdmin();

  const bySeller = typeof sellerId === 'string' && /^[0-9a-f-]{36}$/i.test(sellerId);
  const [result, sellersResult] = await Promise.all([
    api<{ listings: AdminListing[] }>(
      bySeller ? `/v1/admin/listings?sellerId=${sellerId}` : '/v1/admin/listings',
      { token },
    ),
    api<{ sellers: { id: string; displayName: string; listingCount: number }[] }>(
      '/v1/admin/sellers',
      { token },
    ),
  ]);
  const listings = result.ok ? result.data.listings : [];
  const sellers = sellersResult.ok ? sellersResult.data.sellers : [];
  const viewing = bySeller ? sellers.find((s) => s.id === sellerId) : undefined;

  const live = listings.filter((l) => l.state === 'minted').length;
  const drafts = listings.filter((l) => l.state === 'draft').length;
  const withdrawn = listings.filter((l) => l.state === 'withdrawn').length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Products & listings"
      subtitle={
        viewing === undefined
          ? `${listings.length} listing${listings.length === 1 ? '' : 's'} on the floor`
          : `${listings.length} from ${viewing.displayName}`
      }
      sections={sections}
      current="/admin/products"
    >
      <div className="flex flex-col gap-6">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <label htmlFor="sellerId" className="text-sm text-slate-dim">
            Seller
          </label>
          <select
            id="sellerId"
            name="sellerId"
            defaultValue={bySeller ? sellerId : ''}
            className="min-w-56 rounded-sm border border-sand-line bg-sand-raised px-3 py-2 text-sm text-slate"
          >
            <option value="">Everyone</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} ({s.listingCount})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full bg-primary px-5 py-2 text-xs text-cream transition-colors hover:bg-secondary"
          >
            Show
          </button>
          {bySeller && (
            <a
              href="/admin/products"
              className="rounded-full border border-sand-line px-5 py-2 text-xs text-slate-dim"
            >
              Clear
            </a>
          )}
        </form>

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
                        {/* Straight to everything else this seller has listed —
                            the usual next question after finding one problem. */}
                        <a
                          href={`/admin/products?sellerId=${l.sellerId}`}
                          className="underline-offset-4 hover:text-accent-deep hover:underline"
                        >
                          {l.sellerName}
                        </a>
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
                              <label className="flex flex-col gap-1">
                                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                                  Description
                                </span>
                                <textarea
                                  name="description"
                                  rows={5}
                                  defaultValue={l.description ?? ''}
                                  placeholder="What the buyer should know"
                                  className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs leading-relaxed text-slate"
                                />
                              </label>
                              <button
                                type="submit"
                                className="rounded-full bg-primary px-3 py-1.5 text-xs text-cream transition-colors hover:bg-secondary"
                              >
                                Save changes
                              </button>
                              <span className="text-[10px] leading-snug text-slate-dim">
                                Every change is written to the audit log against your account.
                                Leaving a box empty leaves that field as it is.
                              </span>
                            </form>

                            {/* A separate form, because a file upload cannot
                                ride along with a JSON patch — and because a
                                photograph should not wait on the rest of the
                                edit being valid. */}
                            <form
                              action={adminUploadPhoto}
                              className="mt-2 flex w-56 flex-col gap-2 rounded-sm border border-sand-line bg-sand p-3"
                            >
                              <input type="hidden" name="listingId" value={l.id} />
                              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                                Add a photograph
                              </span>
                              <select
                                name="kind"
                                defaultValue="obverse"
                                className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs text-slate"
                              >
                                <option value="obverse">Front</option>
                                <option value="reverse">Back</option>
                                <option value="detail">Detail</option>
                                <option value="uv">Under UV</option>
                              </select>
                              <input
                                type="file"
                                name="file"
                                accept="image/jpeg,image/png,image/webp"
                                required
                                className="text-[10px] text-slate-dim file:mr-2 file:rounded-full file:border file:border-sand-line file:bg-sand-raised file:px-2 file:py-1 file:text-[10px] file:text-slate"
                              />
                              <button
                                type="submit"
                                className="rounded-full border border-accent-deep px-3 py-1.5 text-xs text-accent-deep transition-colors hover:bg-accent-deep hover:text-cream"
                              >
                                Upload
                              </button>
                              <span className="text-[10px] leading-snug text-slate-dim">
                                JPEG, PNG or WebP, up to 10 MB. It is added alongside the
                                seller&rsquo;s own photographs rather than replacing them.
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
