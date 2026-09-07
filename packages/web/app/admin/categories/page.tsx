import type { Metadata } from 'next';

import { createCategory, deleteCategory, editCategory } from '@/app/actions.ts';
import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Categories',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const KINDS = [
  ['banknote', 'Banknote'],
  ['coin', 'Coin'],
  ['jewellery', 'Jewellery'],
  ['precious_stone', 'Precious stone'],
  ['antique', 'Antique'],
  ['stamp', 'Stamp'],
  ['bond', 'Bond'],
  ['share_certificate', 'Share certificate'],
  ['ephemera', 'Ephemera'],
  ['other', 'Something else'],
] as const;

interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  kind: string;
  parent: string | null;
  sortOrder: number;
  description: string | null;
  listingsOfKind: number;
}

/**
 * The catalogue tree.
 *
 * The count beside each row is of listings of that *kind*, not of that
 * category: a listing carries a kind rather than a category id, so a
 * per-category total does not exist to be shown. Labelled as what it is
 * rather than presented as something more precise than it is.
 */
export default async function AdminCategoriesPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ categories: AdminCategory[] }>('/v1/admin/categories', { token });
  const categories = result.ok ? result.data.categories : [];

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Categories"
      subtitle={`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}
      sections={sections}
      current="/admin/categories"
    >
      <div className="flex flex-col gap-6">
        <Panel title="The catalogue">
          {categories.length === 0 ? (
            <p className="text-sm text-slate-dim">
              No categories defined. They are seeded by migration rather than created here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    <th className="border-b border-sand-line p-3">Name</th>
                    <th className="border-b border-sand-line p-3">Slug</th>
                    <th className="border-b border-sand-line p-3">Kind</th>
                    <th className="border-b border-sand-line p-3">Within</th>
                    <th className="border-b border-sand-line p-3">Listings of kind</th>
                    <th className="border-b border-sand-line p-3">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td className="border-b border-sand-line p-3 text-slate">
                        {c.name}
                        {c.description !== null && (
                          <span className="mt-0.5 block text-xs text-slate-dim">
                            {c.description}
                          </span>
                        )}
                      </td>
                      <td className="border-b border-sand-line p-3 font-mono text-xs text-slate-dim">
                        {c.slug}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {c.kind}
                      </td>
                      <td className="border-b border-sand-line p-3 text-xs text-slate-dim">
                        {c.parent ?? '—'}
                      </td>
                      <td className="border-b border-sand-line p-3 tabular-nums text-slate-dim">
                        {c.listingsOfKind}
                      </td>
                      <td className="border-b border-sand-line p-3">
                        <details>
                          <summary className="cursor-pointer list-none rounded-full border border-sand-line px-3 py-1 text-center text-xs text-slate transition-colors hover:border-accent-deep">
                            Edit
                          </summary>
                          <div className="mt-2 flex w-56 flex-col gap-2 rounded-sm border border-sand-line bg-sand p-3">
                            <form action={editCategory} className="flex flex-col gap-2">
                              <input type="hidden" name="categoryId" value={c.id} />
                              <input
                                name="name"
                                defaultValue={c.name}
                                aria-label="Name"
                                className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs text-slate"
                              />
                              <input
                                name="description"
                                defaultValue={c.description ?? ''}
                                placeholder="Description"
                                aria-label="Description"
                                className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs text-slate"
                              />
                              <input
                                name="sortOrder"
                                type="number"
                                min="0"
                                defaultValue={c.sortOrder}
                                aria-label="Sort order"
                                className="rounded-sm border border-sand-line bg-sand-raised px-2 py-1 text-xs tabular-nums text-slate"
                              />
                              <button
                                type="submit"
                                className="rounded-full bg-primary px-3 py-1.5 text-xs text-cream transition-colors hover:bg-secondary"
                              >
                                Save
                              </button>
                            </form>

                            <form action={deleteCategory}>
                              <input type="hidden" name="categoryId" value={c.id} />
                              <button
                                type="submit"
                                className="w-full rounded-full border border-sand-line px-3 py-1 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                              >
                                Remove
                              </button>
                            </form>

                            <span className="text-[10px] leading-snug text-slate-dim">
                              The address <span className="font-mono">/{c.slug}</span> cannot be
                              changed — links already point at it.
                            </span>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Add a category">
          <form action={createCategory} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Name
              </span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="Princely State coins"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Kind of thing
              </span>
              <select
                name="kind"
                defaultValue="coin"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              >
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Inside
              </span>
              <select
                name="parentId"
                defaultValue=""
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              >
                <option value="">Nothing — top level</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-dim">
                Description
              </span>
              <input
                name="description"
                maxLength={500}
                placeholder="One line, shown under the name"
                className="rounded-sm border border-sand-line bg-sand px-3 py-2 text-sm text-slate"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Add category
              </button>
            </div>
          </form>
          <p className="mt-4 text-xs leading-relaxed text-slate-dim">
            The address is made from the name once and then left alone — a category that quietly
            moves takes every shared link with it. One with categories inside it cannot be removed
            until those are moved out, or they would be orphaned at the top level.
          </p>
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          The count is of listings of the same <em>kind</em> — a listing carries a kind, not a
          category, so a per-category total does not exist yet. Adding a category here does not by
          itself put anything in it.
        </p>
      </div>
    </DashboardShell>
  );
}
