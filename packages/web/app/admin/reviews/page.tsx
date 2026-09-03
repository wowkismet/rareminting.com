import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadAdmin } from '@/lib/admin-dashboard.ts';

export const metadata: Metadata = {
  title: 'Reviews & feedback',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface AdminReview {
  id: string;
  rating: number;
  body: string | null;
  orderNumber: string;
  seller: string;
  reviewer: string;
  createdAt: string;
}

/**
 * Every review, across every seller.
 *
 * Read-only, and deliberately so. A marketplace that can quietly delete the
 * reviews it dislikes has ratings worth nothing to the buyer reading them; if
 * one has to go it should go through the dispute process, which leaves a
 * record of who removed it and why.
 */
export default async function AdminReviewsPage() {
  const { user, token, sections } = await loadAdmin();
  const result = await api<{ reviews: AdminReview[] }>('/v1/admin/reviews', { token });
  const reviews = result.ok ? result.data.reviews : [];

  const average =
    reviews.length === 0
      ? null
      : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
  const poor = reviews.filter((r) => r.rating <= 2).length;

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Reviews & feedback"
      subtitle={
        reviews.length === 0
          ? 'No reviews yet'
          : `${reviews.length} review${reviews.length === 1 ? '' : 's'} across the site`
      }
      sections={sections}
      current="/admin/reviews"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Site average"
            value={average === null ? '—' : `${average} / 5`}
            hint={reviews.length === 0 ? 'nothing to average yet' : `from ${reviews.length}`}
            accent
          />
          <StatCard label="Reviews" value={String(reviews.length)} />
          <StatCard
            label="Two stars or fewer"
            value={String(poor)}
            hint="worth reading first"
          />
        </div>

        <Panel title="Newest first">
          {reviews.length === 0 ? (
            <p className="text-sm text-slate-dim">
              No reviews yet. A buyer can leave one after an order completes.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {reviews.map((r) => (
                <li
                  key={r.id}
                  className={`border-l-2 pl-4 ${r.rating <= 2 ? 'border-ember' : 'border-accent-deep/40'}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-accent-deep">
                      {'★'.repeat(r.rating)}
                      <span className="text-sand-line">{'★'.repeat(5 - r.rating)}</span>
                    </span>
                    <span className="font-mono text-xs text-slate-dim">
                      {r.orderNumber} · {r.createdAt.slice(0, 10)}
                    </span>
                  </div>
                  {r.body !== null && r.body !== '' && (
                    <p className="mt-2 text-sm leading-relaxed text-slate">{r.body}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-dim">
                    {r.reviewer} on <span className="text-slate">{r.seller}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Reviews cannot be removed from here. A rating the rated party — or the marketplace taking
          a commission on their sales — can quietly delete is worth nothing to the buyer reading it.
          A review that genuinely has to go should go through the dispute process, which records who
          removed it and why.
        </p>
      </div>
    </DashboardShell>
  );
}
