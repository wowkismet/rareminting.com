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
  cart = 0,
  saved = 0,
}: {
  orders: number;
  isSeller: boolean;
  cart?: number;
  saved?: number;
}): MenuSection[] {
  return [
    {
      title: 'Buying',
      items: [
        { href: '/account', label: 'Overview' },
        { href: '/cart', label: 'Cart', badge: cart },
        { href: '/saved', label: 'Saved', badge: saved },
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

/** A cart or saved-items line, as the API returns it. */
export interface BasketItem {
  listingId: string;
  title: string;
  state: string;
  saleMode: string;
  priceInr: number | null;
  grade: string | null;
  serialDigits: string | null;
  denomination: number | null;
  imageUrl: string | null;
  sellerName: string;
  addedAt: string;
  available: boolean;
  note?: string;
}

export interface BasketResponse {
  items: BasketItem[];
  count: number;
  availableCount: number;
  totalInr?: number;
}
