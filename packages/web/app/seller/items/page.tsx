import type { Metadata } from 'next';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { ItemRow } from '@/components/ItemRow.tsx';
import { STATE_LABEL, loadSeller, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'My items' };
export const dynamic = 'force-dynamic';

/** Everything the seller has listed, grouped by what needs attention first. */
export default async function SellerItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const { user, data } = await loadSeller();

  const shown =
    state === undefined || state === '' ? data.listings : data.listings.filter((l) => l.state === state);

  // Only offer a filter for states this seller actually has something in.
  const present = [...new Set(data.listings.map((l) => l.state))];

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="My items"
      subtitle={`${data.stats.listings.total} listed · ${data.stats.views.toLocaleString('en-IN')} views`}
      sections={sellerMenu(data)}
      current="/seller/items"
      action={{ href: '/sell', label: 'List something new' }}
    >
      {present.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <a
            href="/seller/items"
            className={
              state === undefined
                ? 'rounded-full bg-primary px-4 py-1.5 text-xs text-cream'
                : 'rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate-dim transition-colors hover:border-accent-deep'
            }
          >
            All ({data.listings.length})
          </a>
          {present.map((s) => (
            <a
              key={s}
              href={`/seller/items?state=${s}`}
              className={
                state === s
                  ? 'rounded-full bg-primary px-4 py-1.5 text-xs text-cream'
                  : 'rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate-dim transition-colors hover:border-accent-deep'
              }
            >
              {STATE_LABEL[s] ?? s} ({data.listings.filter((l) => l.state === s).length})
            </a>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty action={{ href: '/sell', label: 'List your first item' }}>
          {data.listings.length === 0
            ? 'Nothing listed yet. Your items appear here with their photographs, views and status.'
            : 'Nothing in this state.'}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((l) => (
            <ItemRow key={l.id} listing={l} canPublish={data.seller.approved} />
          ))}
        </ul>
      )}
    </DashboardShell>
  );
}
