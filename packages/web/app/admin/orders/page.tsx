import type { Metadata } from 'next';
import { DashboardShell, type MenuSection } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { currentUser } from '@/lib/session.ts';
export const metadata: Metadata = { title: 'Orders Management' };
export const dynamic = 'force-dynamic';
const adminSections: MenuSection[] = [
  { title: 'Dashboard', items: [{ href: '/admin', label: 'Overview' }] },
  { title: 'Management', items: [{ href: '/admin/users', label: 'Users Management' }, { href: '/admin/sellers', label: 'Sellers Management' }, { href: '/admin/products', label: 'Products & Listings' }, { href: '/admin/orders', label: 'Orders Management' }]},
  { title: 'Platform', items: [{ href: '/admin/payments', label: 'Payments & Payouts' }, { href: '/admin/kyc', label: 'KYC Verification' }, { href: '/admin/transactions', label: 'Transactions' }, { href: '/admin/categories', label: 'Categories' }]},
  { title: 'Content', items: [{ href: '/admin/reviews', label: 'Reviews & Feedback' }, { href: '/admin/reports', label: 'Reports & Analytics' }, { href: '/admin/promotions', label: 'Promotions & Banners' }, { href: '/admin/support', label: 'Support Tickets' }]},
  { title: 'System', items: [{ href: '/admin/settings', label: 'System Settings' }, { href: '/admin/audit', label: 'Audit Logs' }, { href: '/admin/backup', label: 'Backup & Security' }]},
];
export default async function Page() {
  const user = await currentUser();
  return <DashboardShell user={user} eyebrow="Admin Panel" title="Orders Management" subtitle="Track and manage all orders" sections={adminSections} current="/admin/orders"><Panel title="Orders"><p className="text-sm text-slate-dim">Orders management interface coming soon.</p></Panel></DashboardShell>;
}
