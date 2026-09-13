import 'server-only';

import type { MenuSection } from '@/components/DashboardShell.tsx';
import { unifiedMenu } from '@/lib/dashboard-menu.ts';

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
 * The menu, from a page that holds the buying counts.
 *
 * A thin wrapper now: there is one menu for everybody, built in
 * lib/dashboard-menu.ts. This keeps the old signature so the pages calling it
 * did not all have to change on the same day, and fills in the buying badges
 * it already has to hand.
 *
 * `isSeller` no longer decides whether selling appears — it always does —
 * only how it reads. Somebody who has never sold gets one invitation to
 * start rather than seven links that would each turn them away.
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
  return unifiedMenu({ isSeller, counts: { orders, cart, saved } });
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
