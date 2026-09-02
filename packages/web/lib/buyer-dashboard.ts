import 'server-only';

import type { MenuSection } from '@/components/DashboardShell.tsx';

/** An order as the list endpoint returns it, from either side. */
export interface BuyerOrder {
  id: string;
  orderNumber: string;
  state: string;
  totalInr: number | null;
  title: string | null;
  serialDigits: string | null;
  role: 'buyer' | 'seller' | string;
  createdAt: string;
}

/**
 * The buyer's menu.
 *
 * A seller link appears only once somebody actually sells, so a buyer is not
 * offered a dashboard that would redirect them straight to a registration form.
 */
export function buyerMenu({
  orders,
  isSeller,
}: {
  orders: number;
  isSeller: boolean;
}): MenuSection[] {
  return [
    {
      title: 'Buying',
      items: [
        { href: '/account', label: 'Overview' },
        { href: '/orders', label: 'My orders', badge: orders },
        { href: '/browse', label: 'Find a date' },
        { href: '/auctions', label: 'Auctions' },
      ],
    },
    {
      title: 'You',
      items: [
        ...(isSeller ? [{ href: '/seller', label: 'Seller dashboard' }] : []),
        { href: '/contact', label: 'Help' },
        { href: '/refunds', label: 'Refunds' },
      ],
    },
  ];
}
