import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { respondToOffer } from '@/app/actions.ts';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Orders & offers' };
export const dynamic = 'force-dynamic';

interface Order {
  id: string;
  orderNumber: string;
  state: string;
  totalInr: number;
  title: string;
  serialDigits: string | null;
  role: string;
  createdAt: string;
}

interface Offer {
  id: string;
  listingId: string;
  title: string;
  amountInr: number;
  state: string;
  message: string | null;
  role: string;
}

const ORDER_STATE: Record<string, string> = {
  created: 'Created',
  payment_pending: 'Awaiting payment',
  paid: 'Paid',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  inspection: 'Inspection window',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  disputed: 'In dispute',
};

export default async function OrdersPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');
  const token = await sessionToken();

  const ordersResult = await api<{ orders: Order[] }>('/v1/orders', { token });
  const offersResult = await api<{ offers: Offer[] }>('/v1/offers', { token });

  const orders = ordersResult.ok ? ordersResult.data.orders : [];
  const offers = offersResult.ok ? offersResult.data.offers : [];
  const openReceived = offers.filter((o) => o.role === 'seller' && o.state === 'open');

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            The Vault
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate">Orders &amp; offers</h1>
        </div>

        {openReceived.length > 0 && (
          <section>
            <h2 className="mb-4 font-display text-xl text-slate">Offers awaiting your answer</h2>
            <ul className="flex flex-col gap-3">
              {openReceived.map((offer) => (
                <li
                  key={offer.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-accent-deep/40 bg-sand-raised p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate">
                      <span className="font-display text-lg">
                        ₹{offer.amountInr.toLocaleString('en-IN')}
                      </span>{' '}
                      for {offer.title}
                    </p>
                    {offer.message !== null && (
                      <p className="mt-1 text-xs text-slate-dim">&ldquo;{offer.message}&rdquo;</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <form action={respondToOffer}>
                      <input type="hidden" name="offerId" value={offer.id} />
                      <input type="hidden" name="decision" value="accepted" />
                      <button
                        type="submit"
                        className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                      >
                        Accept
                      </button>
                    </form>
                    <form action={respondToOffer}>
                      <input type="hidden" name="offerId" value={offer.id} />
                      <input type="hidden" name="decision" value="declined" />
                      <button
                        type="submit"
                        className="rounded-full border border-sand-line px-4 py-1.5 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl text-slate">Orders</h2>
          {orders.length === 0 ? (
            <p className="rounded-sm border border-sand-line bg-sand-raised p-6 text-sm text-slate-dim">
              No orders yet. Anything you buy or sell appears here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {orders.map((order) => (
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
                    <p className="mt-1 text-xs text-slate-dim">
                      {order.serialDigits ?? order.title} ·{' '}
                      {order.role === 'buyer' ? 'you bought' : 'you sold'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-display text-lg text-slate">
                      ₹{order.totalInr.toLocaleString('en-IN')}
                    </span>
                    <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                      {ORDER_STATE[order.state] ?? order.state}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {offers.filter((o) => o.role === 'buyer').length > 0 && (
          <section>
            <h2 className="mb-4 font-display text-xl text-slate">Offers you have made</h2>
            <ul className="flex flex-col gap-3">
              {offers
                .filter((o) => o.role === 'buyer')
                .map((offer) => (
                  <li
                    key={offer.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
                  >
                    <a href={`/listing/${offer.listingId}`} className="text-sm text-slate">
                      {offer.title}
                    </a>
                    <div className="flex items-center gap-4">
                      <span className="text-slate">₹{offer.amountInr.toLocaleString('en-IN')}</span>
                      <span className="rounded-full border border-sand-line px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-dim">
                        {offer.state}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
