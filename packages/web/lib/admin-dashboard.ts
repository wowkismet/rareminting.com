import 'server-only';

import { notFound } from 'next/navigation';

import type { MenuSection } from '@/components/DashboardShell.tsx';
import { api, type ApiUser } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

/**
 * Shared loading and navigation for the admin console.
 *
 * The menu lives here rather than in each page so the sixteen entries cannot
 * drift apart, which they had begun to: every page carried its own copy.
 */

export interface AdminCounts {
  kycPending: number;
  disputesOpen: number;
}

export const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

export function adminMenu(counts: AdminCounts = { kycPending: 0, disputesOpen: 0 }): MenuSection[] {
  return [
    {
      title: 'Dashboard',
      items: [{ href: '/admin', label: 'Overview' }],
    },
    {
      title: 'Management',
      items: [
        { href: '/admin/users', label: 'Users' },
        { href: '/admin/sellers', label: 'Sellers', badge: counts.kycPending },
        { href: '/admin/products', label: 'Products & listings' },
        { href: '/admin/orders', label: 'Orders', badge: counts.disputesOpen },
      ],
    },
    {
      title: 'Platform',
      items: [
        { href: '/admin/payments', label: 'Payments & payouts' },
        { href: '/admin/kyc', label: 'KYC verification', badge: counts.kycPending },
        { href: '/admin/transactions', label: 'Transactions' },
        { href: '/admin/categories', label: 'Categories' },
      ],
    },
    {
      title: 'Content',
      items: [
        { href: '/admin/reviews', label: 'Reviews & feedback' },
        { href: '/admin/reports', label: 'Reports & analytics' },
        { href: '/admin/promotions', label: 'Promotions & banners' },
        { href: '/admin/support', label: 'Support tickets' },
      ],
    },
    {
      title: 'System',
      items: [
        { href: '/admin/settings', label: 'System settings' },
        { href: '/admin/audit', label: 'Audit logs' },
        { href: '/admin/backup', label: 'Backup & security' },
      ],
    },
  ];
}

/**
 * The signed-in admin, their menu counts, and a token for further calls.
 *
 * 404s a non-admin rather than 403ing them, mirroring the API: the existence
 * of the console is not something a curious buyer needs confirmed.
 */
export async function loadAdmin(): Promise<{
  user: ApiUser | null;
  token: string | undefined;
  sections: MenuSection[];
}> {
  const user = await currentUser();
  const token = (await sessionToken()) ?? undefined;

  const overview = await api<{ alerts?: { kycPending?: number; disputesOpen?: number } }>(
    '/v1/admin/overview',
    { token },
  );
  if (!overview.ok) notFound();

  const alerts = overview.data.alerts ?? {};
  return {
    user,
    token,
    sections: adminMenu({
      kycPending: alerts.kycPending ?? 0,
      disputesOpen: alerts.disputesOpen ?? 0,
    }),
  };
}
