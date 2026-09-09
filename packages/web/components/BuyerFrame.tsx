import 'server-only';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu, type BasketResponse } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

/**
 * A page that belongs to both the public site and the customer panel.
 *
 * Find a date, Auctions, Contact and Refunds are all on the buyer's side menu,
 * and all four were plain public pages — so following any of them from inside
 * the panel dropped the menu and stranded the customer on the marketing site,
 * with no way back except the browser's back button. They are still public,
 * because a stranger has to be able to read the refunds policy; the difference
 * is that a signed-in customer now keeps the furniture they were navigating
 * with.
 *
 * Signed out, this is exactly the old page: site header, content, footer.
 */
export async function BuyerFrame({
  current,
  eyebrow,
  title,
  subtitle,
  action,
  compactHeader = true,
  children,
}: {
  /** The menu entry this page is, so the sidebar marks it. */
  current: string;
  eyebrow: string;
  title: string;
  subtitle?: string | undefined;
  action?: { href: string; label: string } | undefined;
  compactHeader?: boolean;
  children: React.ReactNode;
}) {
  const user = await currentUser();

  if (user === null) {
    return (
      <div>
        <SiteHeader user={null} compact={compactHeader} />
        <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-14">{children}</main>
        <SiteFooter />
      </div>
    );
  }

  // Only fetched for somebody signed in, and only to badge the menu. A failure
  // here must not take the page down with it, so each count falls back to zero
  // rather than throwing — a missing badge is a smaller problem than a blank
  // refunds policy.
  const token = await sessionToken();
  const [cart, saved, orders, seller] = await Promise.all([
    api<BasketResponse>('/v1/cart', { token }),
    api<BasketResponse>('/v1/saved', { token }),
    api<{ orders: { role: string }[] }>('/v1/orders', { token }),
    currentSeller(),
  ]);

  return (
    <DashboardShell
      user={user}
      eyebrow={eyebrow}
      title={title}
      {...(subtitle === undefined ? {} : { subtitle })}
      {...(action === undefined ? {} : { action })}
      sections={buyerMenu({
        orders: orders.ok ? orders.data.orders.filter((o) => o.role !== 'seller').length : 0,
        isSeller: seller !== null,
        cart: cart.ok ? cart.data.count : 0,
        saved: saved.ok ? saved.data.count : 0,
      })}
      current={current}
    >
      {children}
    </DashboardShell>
  );
}
