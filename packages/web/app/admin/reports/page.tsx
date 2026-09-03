import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { CategoryDonut, Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { adminMenu, rupees } from '@/lib/admin-dashboard.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Reports & analytics',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Overview {
  kpis: {
    totalGmvInr: number;
    totalOrders: number;
    totalUsers: number;
    totalSellers: number;
    totalProducts: number;
    totalRevenueInr: number;
  };
  trend: { gmvPct: number | null; ordersPct: number | null };
  alerts: { kycPending: number; disputesOpen: number };
  salesSeries: { day: string; gmvInr: number }[];
  categoryBreakdown: { category: string; gmvInr: number; orders: number }[];
  sellerPerformance: {
    seller: string;
    totalSalesInr: number;
    orders: number;
    rating: number | null;
    reviewCount: number;
  }[];
}

const COLOURS = ['#1a4a2e', '#1a4a46', '#c9a84c', '#8b7355', '#d3d3d3'];

function pct(p: number | null): string {
  return p === null ? 'no earlier period to compare' : `${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%`;
}

/**
 * The numbers, gathered rather than scattered.
 *
 * Everything here is measured. Where a figure cannot be measured it is absent
 * rather than estimated — an average order value across four orders is
 * arithmetic, but a conversion rate without a record of who looked and did not
 * buy is a guess dressed as a metric.
 */
export default async function AdminReportsPage() {
  const user = await currentUser();
  const token = await sessionToken();

  const overview = await api<Overview>('/v1/admin/overview', { token });
  if (!overview.ok) notFound();
  const o = overview.data;

  const aov = o.kpis.totalOrders === 0 ? null : o.kpis.totalGmvInr / o.kpis.totalOrders;
  const takeRate =
    o.kpis.totalGmvInr === 0 ? null : (o.kpis.totalRevenueInr / o.kpis.totalGmvInr) * 100;
  const perSeller = o.kpis.totalSellers === 0 ? null : o.kpis.totalProducts / o.kpis.totalSellers;
  const thirtyDay = o.salesSeries.reduce((sum, d) => sum + d.gmvInr, 0);
  const categoryTotal = o.categoryBreakdown.reduce((sum, c) => sum + c.gmvInr, 0);

  return (
    <DashboardShell
      user={user}
      eyebrow="Staff only"
      title="Reports & analytics"
      subtitle="Everything measured, nothing estimated"
      sections={adminMenu({ kycPending: o.alerts.kycPending, disputesOpen: o.alerts.disputesOpen })}
      current="/admin/reports"
    >
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Average order"
            value={aov === null ? '—' : rupees(Math.round(aov))}
            hint={aov === null ? 'no orders yet' : `across ${o.kpis.totalOrders}`}
            accent
          />
          <StatCard
            label="Effective take rate"
            value={takeRate === null ? '—' : `${takeRate.toFixed(1)}%`}
            hint="commission and GST, over GMV"
          />
          <StatCard
            label="Listings per seller"
            value={perSeller === null ? '—' : perSeller.toFixed(1)}
          />
          <StatCard label="Last thirty days" value={rupees(thirtyDay)} hint={pct(o.trend.gmvPct)} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Where the money comes from">
            {categoryTotal === 0 ? (
              <p className="py-8 text-center text-sm text-slate-dim">
                Nothing sold yet, so there is no split to show.
              </p>
            ) : (
              <CategoryDonut
                slices={o.categoryBreakdown
                  .filter((c) => c.gmvInr > 0)
                  .map((c, i) => ({
                    label: c.category,
                    value: c.gmvInr,
                    colour: COLOURS[i % COLOURS.length] as string,
                  }))}
              />
            )}
          </Panel>

          <Panel title="Sellers by sales" action={{ href: '/admin/sellers', label: 'All sellers' }}>
            {o.sellerPerformance.length === 0 ? (
              <p className="text-sm text-slate-dim">No sellers yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {o.sellerPerformance.slice(0, 8).map((s) => (
                  <li
                    key={s.seller}
                    className="flex items-baseline justify-between gap-3 border-b border-sand-line pb-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-slate">{s.seller}</p>
                      <p className="text-xs text-slate-dim">
                        {s.orders} order{s.orders === 1 ? '' : 's'}
                        {s.rating !== null && ` · ${s.rating}★ from ${s.reviewCount}`}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-slate">
                      {rupees(s.totalSalesInr)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <p className="rounded-sm border border-sand-line bg-sand-raised p-5 text-sm leading-relaxed text-slate-dim">
          Absent on purpose: conversion rate, repeat-buyer rate and traffic. None of the three can
          be derived from what is recorded — there is a view counter on each listing but no record
          of who looked and did not buy, so any figure would be a guess wearing a percentage sign.
          They become real once there is a session-level record of browsing to measure them against.
        </p>
      </div>
    </DashboardShell>
  );
}
