import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Categories',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Categories are seeded by migration, so this page reads rather than edits. The count is of
          listings of the same <em>kind</em> — a listing carries a kind, not a category, so a
          per-category total does not exist yet.
        </p>
      </div>
    </DashboardShell>
  );
}
