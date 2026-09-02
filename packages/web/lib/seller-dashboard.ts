import 'server-only';

import { redirect } from 'next/navigation';

import { api, type ApiUser } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';
import type { MenuSection } from '@/components/DashboardShell.tsx';

/**
 * Shared loading and navigation for the seller's pages.
 *
 * Every seller page draws from one endpoint, so the menu counts are consistent
 * between them — a badge saying four items missing photographs always agrees
 * with the page that lists them.
 */

export interface SellerListing {
  id: string;
  title: string;
  state: string;
  kind: string;
  saleMode: string;
  priceInr: number | null;
  grade: string | null;
  views: number;
  photoCount: number;
  imageUrl: string | null;
  serialDigits: string | null;
  denomination: number | null;
  createdAt: string;
}

export interface Dashboard {
  seller: { displayName: string; kycState: string; approved: boolean };
  stats: {
    listings: {
      total: number;
      draft: number;
      inReview: number;
      live: number;
      reserved: number;
      sold: number;
      withdrawn: number;
    };
    byKind: { notes: number; coins: number; other: number };
    views: number;
    sales: {
      orders: number;
      completed: number;
      awaitingPayment: number;
      awaitingDispatch: number;
      grossInr: number;
      payoutInr: number;
      committedInr: number;
    };
    auctions: { live: number; scheduled: number; ended: number; bids: number };
  };
  listings: SellerListing[];
}

export const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  minted: 'Live',
  reserved: 'Reserved',
  struck: 'Sold',
  withdrawn: 'Withdrawn',
  rejected: 'Rejected',
};

export const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * The signed-in seller and their dashboard.
 *
 * Redirects rather than returning an error: a signed-out visitor belongs at
 * sign-in, and somebody who has not registered belongs at the page that
 * registers them.
 */
export async function loadSeller(): Promise<{ user: ApiUser; data: Dashboard }> {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const result = await api<Dashboard>('/v1/sellers/me/dashboard', { token });
  if (!result.ok) redirect('/sell');

  return { user, data: result.data };
}

export function sellerMenu(data: Dashboard): MenuSection[] {
  const needsPhotos = data.listings.filter((l) => l.photoCount === 0).length;
  return [
    {
      title: 'Selling',
      items: [
        { href: '/seller', label: 'Overview' },
        { href: '/sell', label: 'List an item' },
        { href: '/seller/items', label: 'My items', badge: data.stats.listings.total },
        { href: '/seller/photos', label: 'Needs photos', badge: needsPhotos },
        {
          href: '/seller/auctions',
          label: 'My auctions',
          badge: data.stats.auctions.live + data.stats.auctions.scheduled,
        },
      ],
    },
    {
      title: 'Money',
      items: [
        { href: '/orders', label: 'Orders', badge: data.stats.sales.orders },
        { href: '/seller/payouts', label: 'Payouts' },
      ],
    },
    {
      title: 'You',
      items: [
        { href: '/account', label: 'Account' },
        { href: '/contact', label: 'Help' },
      ],
    },
  ];
}

/**
 * The dashboard, or null when the visitor is not a seller.
 *
 * Unlike loadSeller this never redirects, so it can be used on pages a
 * non-seller is allowed to reach — the sell page itself most obviously, where
 * redirecting to /sell would loop.
 */
export async function loadSellerOrNull(): Promise<{
  user: ApiUser;
  data: Dashboard;
} | null> {
  const user = await currentUser();
  if (user === null) return null;

  const token = await sessionToken();
  const result = await api<Dashboard>('/v1/sellers/me/dashboard', { token });
  return result.ok ? { user, data: result.data } : null;
}
