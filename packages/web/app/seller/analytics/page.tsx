import type { Metadata } from 'next';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { CategoryDonut, Panel, SalesChart, StatCard } from '@/components/DashboardPanels.tsx';
import { loadSeller, rupees, sellerMenu } from '@/lib/seller-dashboard.ts';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

/**
 * How the shop is doing.
 *
 * Every figure here is counted from real activity. Where there is no activity
 * the page says so rather than showing a zero that reads like a measurement —
 * a conversion rate of 0% from four views is noise, not a finding.
 */
export default async function SellerAnalyticsPage() {
  const { user, data } = await loadSeller();
  const { stats, listings, salesSeries } = data;

  const totalViews = stats.views;
  const sold = stats.listings.sold + stats.sales.completed;
  const withPhotos = listings.filter((l) => l.photoCount > 0).length;

  // Views per listing, best first. The only performance signal available
  // before a shop has sales history.
  const ranked = [...listings].sort((a, b) => b.views - a.views).slice(0, 10);
  const busiest = ranked.filter((l) => l.views > 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="The Mint"
      title="Analytics"
      subtitle="Counted from real activity, not estimated"
      sections={sellerMenu(data)}
      current="/seller/analytics"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Views" value={totalViews.toLocaleString('en-IN')} hint="excludes your own" accent />
          <StatCard label="Live listings" value={String(stats.listings.live)} />
          <StatCard label="Orders" value={String(stats.sales.orders)} />
          <StatCard
            label="Views per listing"
            value={stats.listings.total === 0 ? '—' : (totalViews / stats.listings.total).toFixed(1)}
            hint="across everything you have listed"
          />
        </div>

        <Panel title="Sales, last 30 days">
          <SalesChart series={salesSeries} />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="What you list">
            <CategoryDonut
              slices={[
                { label: 'Banknotes', value: stats.byKind.notes, colour: '#1a4a2e' },
                { label: 'Coins', value: stats.byKind.coins, colour: '#c9a84c' },
                { label: 'Other collectibles', value: stats.byKind.other, colour: '#1a4a46' },
              ]}
            />
          </Panel>

          <Panel title="Where listings stand">
            <dl className="flex flex-col gap-2 text-sm">
              {(
                [
                  ['Live', stats.listings.live],
                  ['Draft', stats.listings.draft],
                  ['Reserved', stats.listings.reserved],
                  ['Sold', stats.listings.sold],
                  ['Withdrawn', stats.listings.withdrawn],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-dim">{label}</dt>
                  <dd className="tabular-nums text-slate">{value}</dd>
                </div>
              ))}
              <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-sand-line pt-3">
                <dt className="text-slate-dim">With a photograph</dt>
                <dd className="tabular-nums text-slate">
                  {withPhotos} of {listings.length}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>

        <Panel title="Most looked at" action={{ href: '/seller/items', label: 'All items' }}>
          {busiest.length === 0 ? (
            <p className="text-sm text-slate-dim">
              Nothing has been viewed yet. Views are counted when somebody other than you opens a
              live listing, so this fills once your items are published and found.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {busiest.map((l) => {
                const share = totalViews === 0 ? 0 : (l.views / totalViews) * 100;
                return (
                  <li key={l.id} className="flex items-center gap-3 text-sm">
                    <a
                      href={`/listing/${l.id}`}
                      className="w-32 shrink-0 truncate font-mono text-xs text-slate underline-offset-4 hover:underline"
                    >
                      {l.serialDigits ?? l.title}
                    </a>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-sand">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(share, 3)}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-slate-dim">
                      {l.views} view{l.views === 1 ? '' : 's'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Money">
          <dl className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['Cleared', rupees(stats.sales.grossInr), 'buyers paid, payment settled'],
                ['Your share', rupees(stats.sales.payoutInr), 'after commission, GST and TDS'],
                ['Committed', rupees(stats.sales.committedInr), 'includes orders awaiting payment'],
              ] as const
            ).map(([label, value, hint]) => (
              <div key={label}>
                <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                  {label}
                </dt>
                <dd className="mt-1 font-display text-2xl tabular-nums text-slate">{value}</dd>
                <p className="mt-1 text-xs text-slate-dim">{hint}</p>
              </div>
            ))}
          </dl>
        </Panel>

        {sold === 0 && (
          <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm text-slate-dim">
            Conversion and repeat-buyer figures need completed sales to mean anything, so they are
            not shown yet. They appear once orders start completing.
          </p>
        )}
      </div>
    </DashboardShell>
  );
}
