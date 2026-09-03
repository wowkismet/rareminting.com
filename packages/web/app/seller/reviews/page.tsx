import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { loadSeller, sellerMenu } from '@/lib/seller-dashboard.ts';
import { sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

interface Review {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  orderNumber: string;
  reviewer: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} className="text-accent-deep">
      {'★'.repeat(rating)}
      <span className="text-sand-line">{'★'.repeat(5 - rating)}</span>
    </span>
  );
}

/**
 * What buyers said.
 *
 * A rating with no count behind it is close to meaningless, so the average is
 * never shown on its own — and with no reviews at all this shows no rating
 * rather than a zero, which would read as a bad one.
 */
export default async function SellerReviewsPage() {
  const { user, data } = await loadSeller();
  const token = await sessionToken();
  const result = await api<{ reviews: Review[] }>('/v1/sellers/me/reviews', { token });
  const reviews = result.ok ? result.data.reviews : [];
  const { average, count } = data.reviews;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Reviews"
      subtitle={
        count === 0
          ? 'No reviews yet'
          : `${average} out of 5 from ${count} review${count === 1 ? '' : 's'}`
      }
      sections={sellerMenu(data)}
      current="/seller/reviews"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Average rating"
            value={average === null ? '—' : `${average} / 5`}
            hint={count === 0 ? 'nothing to average yet' : `from ${count}`}
            accent
          />
          <StatCard label="Reviews" value={String(count)} />
          <StatCard
            label="Orders completed"
            value={String(data.stats.sales.completed)}
            hint="a review follows a completed order"
          />
        </div>

        <Panel title="What buyers said">
          {reviews.length === 0 ? (
            <Empty action={{ href: '/seller/items', label: 'See your items' }}>
              No reviews yet. A buyer can leave one after an order completes, so the first arrives
              once a sale has run its course.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-4">
              {reviews.map((r) => (
                <li key={r.id} className="border-l-2 border-accent-deep/40 pl-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <Stars rating={r.rating} />
                    <span className="font-mono text-xs text-slate-dim">
                      {r.orderNumber} · {r.createdAt.slice(0, 10)}
                    </span>
                  </div>
                  {r.body !== null && r.body !== '' && (
                    <p className="mt-2 text-sm leading-relaxed text-slate">{r.body}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-dim">{r.reviewer}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Reviews cannot be edited or removed by a seller. A rating the rated party can delete is
          worth nothing to the buyer reading it.
        </p>
      </div>
    </DashboardShell>
  );
}
