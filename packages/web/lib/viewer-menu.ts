import 'server-only';

import type { MenuSection } from '@/components/DashboardShell.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu } from '@/lib/buyer-dashboard.ts';
import { loadSellerOrNull, sellerMenu } from '@/lib/seller-dashboard.ts';
import { sessionToken } from '@/lib/session.ts';

/**
 * The left menu for a page both roles reach.
 *
 * Orders is the obvious one: a seller arrives there from "Orders" in their own
 * menu and a buyer from "My orders" in theirs, and whichever menu they came
 * from should still be beside them when they arrive. Without this the sidebar
 * simply vanishes on the way, which reads as the page having lost its way
 * rather than as a deliberate change of context.
 *
 * A seller who also buys gets the seller menu, because it is the larger of the
 * two and carries the seller dashboard link back to everything else.
 */
export async function viewerMenu(): Promise<MenuSection[]> {
  const seller = await loadSellerOrNull();
  if (seller !== null) return sellerMenu(seller.data);

  const token = await sessionToken();
  const dash = await api<{ stats: { orders: number; cart: number; saved: number } }>(
    '/v1/me/dashboard',
    { token },
  );
  const s = dash.ok ? dash.data.stats : { orders: 0, cart: 0, saved: 0 };

  return buyerMenu({
    orders: s.orders,
    isSeller: false,
    cart: s.cart,
    saved: s.saved,
  });
}
