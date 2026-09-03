import type { Metadata } from 'next';
import { DashboardShell, type MenuSection } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { currentUser } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Users Management', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const user = await currentUser();

  const sections: MenuSection[] = [
    {
      title: 'Dashboard',
      items: [{ href: '/admin', label: 'Overview' }],
    },
    {
      title: 'Management',
      items: [
        { href: '/admin/users', label: 'Users Management' },
        { href: '/admin/sellers', label: 'Sellers Management' },
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
        { href: '/admin/support', label: 'Support Tickets' },
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
      title="Users Management"
      subtitle="Manage user accounts and permissions"
      sections={sections}
      current="/admin/users"
    >
      <Panel title="Users">
        <p className="text-sm text-slate-dim">Users management interface coming soon.</p>
      </Panel>
    </DashboardShell>
  );
}
