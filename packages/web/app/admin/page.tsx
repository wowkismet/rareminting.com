import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DashboardShell, type MenuSection } from '@/components/DashboardShell.tsx';
import { Panel, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Admin Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface AdminOverview {
  kpis: {
    totalGmvInr: number;
    totalOrders: number;
    totalUsers: number;
    totalSellers: number;
    totalProducts: number;
    totalRevenueInr: number;
  };
  alerts: {
    pendingPayoutsInr: number;
    disputesOpen: number;
    kycPending: number;
    activeListings: number;
    lowStockCount: number;
    supportTicketsOpen: number;
  };
  salesSeries: { day: string; gmvInr: number }[];
  categoryBreakdown: { category: string; gmvInr: number; orders: number }[];
  recentOrders: { orderNumber: string; user: string; amountInr: number; status: string; date: string }[];
  topProducts: { title: string; category: string; sold: number; revenueInr: number }[];
  sellerPerformance: { seller: string; totalSalesInr: number; orders: number; rating: number }[];
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

function KpiCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: string;
  icon: string;
  trend?: string;
}) {
  return (
    <div className="rounded-sm border border-sand-line bg-primary p-4 text-cream">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-mono uppercase tracking-wider text-cream-dim">{label}</p>
          <p className="mt-2 text-2xl font-display tabular-nums">{value}</p>
          {trend && <p className="mt-1 text-xs text-accent">{trend}</p>}
        </div>
        <span className="text-3xl opacity-50">{icon}</span>
      </div>
    </div>
  );
}

function AlertTile({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: string | number;
  icon: string;
  href: string;
}) {
  return (
    <a href={href} className="group rounded-sm border border-sand-line bg-sand-raised p-4 transition-colors hover:bg-sand">
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <div className="flex-1">
          <p className="text-sm text-slate-dim group-hover:text-slate">{label}</p>
          <p className="mt-1 font-display text-xl text-slate tabular-nums">{value}</p>
        </div>
      </div>
    </a>
  );
}

export default async function AdminDashboardPage() {
  const user = await currentUser();
  const token = await sessionToken();

  const overview = await api<AdminOverview>('/v1/admin/overview', { token });
  if (!overview.ok) notFound();

  const o = overview.data;

  const sections: MenuSection[] = [
    {
      title: 'Dashboard',
      items: [{ href: '/admin', label: 'Overview' }],
    },
    {
      title: 'Management',
      items: [
        { href: '/admin/users', label: 'Users Management' },
        { href: '/admin/sellers', label: 'Sellers Management', badge: o.alerts.kycPending },
        { href: '/admin/products', label: 'Products & Listings' },
        { href: '/admin/orders', label: 'Orders Management' },
      ],
    },
    {
      title: 'Platform',
      items: [
        { href: '/admin/payments', label: 'Payments & Payouts' },
        { href: '/admin/kyc', label: 'KYC Verification' },
        { href: '/admin/transactions', label: 'Transactions' },
        { href: '/admin/categories', label: 'Categories' },
      ],
    },
    {
      title: 'Content',
      items: [
        { href: '/admin/reviews', label: 'Reviews & Feedback' },
        { href: '/admin/reports', label: 'Reports & Analytics' },
        { href: '/admin/promotions', label: 'Promotions & Banners' },
        { href: '/admin/support', label: 'Support Tickets', badge: o.alerts.supportTicketsOpen },
      ],
    },
    {
      title: 'System',
      items: [
        { href: '/admin/settings', label: 'System Settings' },
        { href: '/admin/audit', label: 'Audit Logs' },
        { href: '/admin/backup', label: 'Backup & Security' },
      ],
    },
  ];

  return (
    <DashboardShell
      user={user}
      eyebrow="Admin Panel"
      title="Admin Dashboard"
      subtitle="Welcome back, Admin! Here's what's happening with Rareminting.com today."
      sections={sections}
      current="/admin"
    >
      <div className="flex flex-col gap-8">
        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <KpiCard
            label="Total GMV"
            value={rupees(o.kpis.totalGmvInr)}
            icon="📊"
            trend="▲ 28.6% vs Apr 2025"
          />
          <KpiCard
            label="Total Orders"
            value={o.kpis.totalOrders.toLocaleString()}
            icon="🛍️"
            trend="▲ 19.4% vs Apr 2025"
          />
          <KpiCard
            label="Total Users"
            value={o.kpis.totalUsers.toLocaleString()}
            icon="👥"
            trend="▲ 21.7% vs Apr 2025"
          />
          <KpiCard
            label="Total Sellers"
            value={o.kpis.totalSellers.toLocaleString()}
            icon="🏪"
            trend="▲ 16.3% vs Apr 2025"
          />
          <KpiCard
            label="Total Products"
            value={o.kpis.totalProducts.toLocaleString()}
            icon="📦"
            trend="▲ 14.8% vs Apr 2025"
          />
          <KpiCard
            label="Total Revenue"
            value={rupees(o.kpis.totalRevenueInr)}
            icon="₹"
            trend="▲ 26.1% vs Apr 2025"
          />
        </div>

        {/* Sales Overview and Category Breakdown */}
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Panel title="Sales Overview">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-dim">Total GMV</p>
                  <p className="mt-1 font-display text-xl text-slate">{rupees(o.kpis.totalGmvInr)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-dim">Total Revenue</p>
                  <p className="mt-1 font-display text-xl text-slate">{rupees(o.kpis.totalRevenueInr)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-dim">Total Payouts</p>
                  <p className="mt-1 font-display text-xl text-slate">{rupees(o.kpis.totalGmvInr * 0.8)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-dim">Net Profit</p>
                  <p className="mt-1 font-display text-xl text-slate">{rupees(o.kpis.totalGmvInr * 0.2)}</p>
                </div>
              </div>
              <svg viewBox="0 0 800 200" className="h-40 w-full">
                <defs>
                  <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style={{ stopColor: '#c9a84c', stopOpacity: 0.3 }} />
                    <stop offset="100%" style={{ stopColor: '#c9a84c', stopOpacity: 0 }} />
                  </linearGradient>
                </defs>
                <polyline
                  points={o.salesSeries.map((s, i) => `${(i / o.salesSeries.length) * 800},${200 - (s.gmvInr / Math.max(...o.salesSeries.map(x => x.gmvInr))) * 160}`).join(' ')}
                  fill="none"
                  stroke="#c9a84c"
                  strokeWidth="2"
                />
                <polygon
                  points={`0,200 ${o.salesSeries.map((s, i) => `${(i / o.salesSeries.length) * 800},${200 - (s.gmvInr / Math.max(...o.salesSeries.map(x => x.gmvInr))) * 160}`).join(' ')} 800,200`}
                  fill="url(#gradient)"
                />
              </svg>
            </div>
          </Panel>

          <Panel title="Sales by Category">
            <div className="space-y-4">
              <svg viewBox="0 0 120 120" className="mx-auto h-32 w-32">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="30" />
                {o.categoryBreakdown.map((cat, i) => {
                  const total = o.categoryBreakdown.reduce((sum, c) => sum + c.gmvInr, 0);
                  const percent = (cat.gmvInr / total) * 100;
                  const startAngle = o.categoryBreakdown.slice(0, i).reduce((sum, c) => sum + (c.gmvInr / total) * 100, 0);
                  const circumference = 2 * Math.PI * 50;
                  const offset = (startAngle / 100) * circumference;
                  const length = (percent / 100) * circumference;
                  const colors = ['#1a4a2e', '#1a4a46', '#c9a84c', '#8b7355', '#d3d3d3'];
                  return (
                    <circle
                      key={i}
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke={colors[i % colors.length]}
                      strokeWidth="30"
                      strokeDasharray={`${length} ${circumference}`}
                      strokeDashoffset={-offset}
                      style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px' }}
                    />
                  );
                })}
                <circle cx="60" cy="60" r="35" fill="white" />
                <text x="60" y="55" textAnchor="middle" className="font-mono text-xs font-bold">
                  Total GMV
                </text>
                <text x="60" y="70" textAnchor="middle" className="font-display text-lg font-bold">
                  {rupees(o.kpis.totalGmvInr)}
                </text>
              </svg>
              <div className="space-y-2 text-sm">
                {o.categoryBreakdown.map((cat, i) => {
                  const colors = ['■ #1a4a2e', '■ #1a4a46', '■ #c9a84c', '■ #8b7355', '■ #d3d3d3'];
                  return (
                    <div key={i} className="flex justify-between">
                      <span className="text-slate-dim">{cat.category}</span>
                      <span className="text-slate">{rupees(cat.gmvInr)} ({((cat.gmvInr / o.kpis.totalGmvInr) * 100).toFixed(1)}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>

        {/* Tables */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent Orders */}
          <Panel title="Recent Orders" action={{ href: '/admin/orders', label: 'View All' }}>
            {o.recentOrders.length === 0 ? (
              <p className="text-sm text-slate-dim">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-slate-dim border-b border-sand-line">
                      <th className="pb-2">Order</th>
                      <th className="pb-2">User</th>
                      <th className="pb-2">Amount</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.recentOrders.map((order) => (
                      <tr key={order.orderNumber} className="border-b border-sand-line">
                        <td className="py-2 font-mono text-xs text-slate">{order.orderNumber}</td>
                        <td className="py-2 text-slate-dim">{order.user}</td>
                        <td className="py-2 tabular-nums text-slate">{rupees(order.amountInr)}</td>
                        <td className="py-2 text-xs uppercase">{order.status.replace(/_/g, ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Top Products */}
          <Panel title="Top Selling Products" action={{ href: '/admin/products', label: 'View All' }}>
            {o.topProducts.length === 0 ? (
              <p className="text-sm text-slate-dim">No products yet.</p>
            ) : (
              <div className="space-y-3">
                {o.topProducts.slice(0, 5).map((prod) => (
                  <div key={prod.title} className="flex items-start justify-between border-b border-sand-line pb-2">
                    <div className="flex-1">
                      <p className="text-sm text-slate font-mono">{prod.title.slice(0, 20)}</p>
                      <p className="text-xs text-slate-dim">{prod.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono text-slate">{prod.sold} sold</p>
                      <p className="text-xs text-slate-dim">{rupees(prod.revenueInr)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Seller Performance */}
          <Panel title="Seller Performance" action={{ href: '/admin/sellers', label: 'View All' }}>
            {o.sellerPerformance.length === 0 ? (
              <p className="text-sm text-slate-dim">No sellers yet.</p>
            ) : (
              <div className="space-y-3">
                {o.sellerPerformance.slice(0, 5).map((seller) => (
                  <div key={seller.seller} className="flex items-start justify-between border-b border-sand-line pb-2">
                    <div className="flex-1">
                      <p className="text-sm text-slate">{seller.seller}</p>
                      <p className="text-xs text-slate-dim">{seller.orders} orders</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums text-slate">{rupees(seller.totalSalesInr)}</p>
                      <p className="text-xs text-accent">{'★'.repeat(Math.floor(seller.rating))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Alert Tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AlertTile label="Pending Payouts" value={rupees(o.alerts.pendingPayoutsInr)} icon="💳" href="/admin/payments" />
          <AlertTile label="Disputes" value={o.alerts.disputesOpen} icon="⚠️" href="/admin/orders" />
          <AlertTile label="KYC Pending" value={o.alerts.kycPending} icon="👤" href="/admin/kyc" />
          <AlertTile label="Active Listings" value={o.alerts.activeListings.toLocaleString()} icon="📋" href="/admin/products" />
          <AlertTile label="Low Stock Alerts" value={o.alerts.lowStockCount} icon="📦" href="/admin/products" />
          <AlertTile label="Support Tickets" value={o.alerts.supportTicketsOpen} icon="☎️" href="/admin/support" />
        </div>

        {/* Quick Actions */}
        <Panel title="Quick Actions">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Add New Banner', icon: '🎨', href: '#' },
              { label: 'Add Category', icon: '📂', href: '#' },
              { label: 'Approve Sellers', icon: '✓', href: '#' },
              { label: 'Manage Products', icon: '📦', href: '#' },
              { label: 'View Reports', icon: '📊', href: '#' },
              { label: 'System Settings', icon: '⚙️', href: '#' },
              { label: 'Send Notification', icon: '🔔', href: '#' },
              { label: 'Backup Now', icon: '💾', href: '#' },
            ].map((action) => (
              <a key={action.label} href={action.href} className="flex items-center gap-2 rounded-sm border border-sand-line bg-sand-raised p-3 text-sm text-slate transition-colors hover:bg-sand">
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </a>
            ))}
          </div>
        </Panel>
      </div>
    </DashboardShell>
  );
}
