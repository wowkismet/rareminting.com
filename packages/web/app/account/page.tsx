import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { api, type ApiListing } from '@/lib/api.ts';
import { buyerMenu, type BuyerOrder } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * The buyer's dashboard.
 *
 * Buyers had no home of their own — an account page listed a seller's stock and
 * nothing else, so somebody who had only ever bought saw a page about selling.
 * This is what they came for: what they have ordered, what is on its way, and
 * a route back to finding a date.
 */
export default async function AccountPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [seller, orders, floor] = await Promise.all([
    currentSeller(),
    api<{ orders: BuyerOrder[] }>('/v1/orders', { token }),
    api<{ total?: number }>('/v1/listings?limit=1'),
  ]);

  const mine = orders.ok ? orders.data.orders.filter((o) => o.role !== 'seller') : [];
  const open = mine.filter(
    (o) => !['completed', 'cancelled', 'refunded'].includes(o.state),
  );
  const spent = mine
    .filter((o) => !['cancelled', 'refunded'].includes(o.state))
    .reduce((sum, o) => sum + (o.totalInr ?? 0), 0);
  const forSale = floor.ok ? (floor.data.total ?? 0) : 0;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Vault"
      title={user.fullName ?? 'Your account'}
      subtitle={user.email}
      sections={buyerMenu({ orders: mine.length, isSeller: seller !== null })}
      current="/account"
      action={{ href: '/browse', label: 'Find a date' }}
    >
      <div className="flex flex-col gap-10">
        {!user.emailVerified && (
          <p className="rounded-sm border border-accent-deep/40 bg-sand-raised px-5 py-4 text-sm text-slate-dim">
            Your email address is not verified yet. Verification emails are not switched on — it
            does not limit anything you can do today.
          </p>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Your buying</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Tile label="Orders" value={String(mine.length)} />
            <Tile label="In progress" value={String(open.length)} accent />
            <Tile label="Spent" value={rupees(spent)} hint="excludes cancelled" />
            <Tile label="Notes for sale" value={String(forSale)} hint="across the site" />
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-xl text-slate">Recent orders</h2>
            {mine.length > 4 && (
              <a href="/orders" className="text-sm text-accent-deep underline underline-offset-4">
                See all {mine.length}
              </a>
            )}
          </div>

          {mine.length === 0 ? (
            <Empty action={{ href: '/browse', label: 'Find your date' }}>
              You have not bought anything yet. Search a date that matters to you and see which
              notes carry it.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {mine.slice(0, 4).map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                >
                  <div className="min-w-0">
                    <a
                      href={`/orders/${order.id}`}
                      className="font-mono text-sm text-slate underline-offset-4 hover:underline"
                    >
                      {order.orderNumber}
                    </a>
                    <p className="mt-1 text-xs text-slate-dim">{order.title ?? 'Item'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                      {order.state.replace(/_/g, ' ')}
                    </span>
                    <span className="font-display text-lg tabular-nums text-slate">
                      {order.totalInr === null ? '—' : rupees(order.totalInr)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Selling</h2>
          {seller === null ? (
            <Empty action={{ href: '/sell', label: 'Register as a seller' }}>
              You have not registered as a seller. It takes six details, and once an admin approves
              you there is no limit on how much you can list.
            </Empty>
          ) : (
            <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
              <p className="text-sm text-slate-dim">
                Selling as <span className="text-slate">{seller.displayName}</span> ·{' '}
                {seller.approved ? 'approved' : `KYC ${seller.kycState}`}
              </p>
              <a
                href="/seller"
                className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-secondary"
              >
                Open seller dashboard
              </a>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
