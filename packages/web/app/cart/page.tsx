import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { buyNow, removeFromCart, saveForLater } from '@/app/actions.ts';
import { checkoutCart } from '@/app/actions.ts';

/**
 * Kept in step with packages/api/src/charges.ts, which is where they are set
 * and which decides what is actually charged. These exist so the cart can show
 * a total before the buyer commits; if the two ever disagree, the API wins and
 * the payment page shows the truth.
 */
const DELIVERY_PER_SELLER = 60;
const FREE_DELIVERY_ABOVE = 5000;
import { BannerSlot } from '@/components/BannerSlot.tsx';
import { DashboardShell, Empty, Tile } from '@/components/DashboardShell.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu, type BasketResponse } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Your cart' };
export const dynamic = 'force-dynamic';

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * The cart.
 *
 * Every note here is one of a kind, so a cart cannot work the way it does in a
 * shop with stock on shelves: nothing is held. Two people can have the same
 * note in their carts and the first to buy it gets it. Rather than paper over
 * that, each line says plainly whether the item is still available, and one
 * that has gone cannot be bought from here.
 */
export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [cart, saved, orders, seller] = await Promise.all([
    api<BasketResponse>('/v1/cart', { token }),
    api<BasketResponse>('/v1/saved', { token }),
    api<{ orders: { role: string }[] }>('/v1/orders', { token }),
    currentSeller(),
  ]);

  const items = cart.ok ? cart.data.items : [];
  const gone = items.filter((i) => !i.available);
  const buyable = items.filter((i) => i.available);
  const unavailable = items.length - buyable.length;
  const sellerCount = new Set(buyable.map((i) => i.sellerName)).size;

  const total = cart.ok ? (cart.data.totalInr ?? 0) : 0;
  const myOrders = orders.ok ? orders.data.orders.filter((o) => o.role !== 'seller').length : 0;

  // Shown so the buyer can see the total before committing. The API works
  // these out again at checkout and its answer is the one that is charged —
  // this is a preview, not the price.
  const freeDelivery = total >= FREE_DELIVERY_ABOVE;
  const delivery = freeDelivery ? 0 : DELIVERY_PER_SELLER * Math.max(sellerCount, 1);

  return (
    <DashboardShell
      user={user}
      eyebrow="The Vault"
      title="Your cart"
      subtitle={
        items.length === 0
          ? 'Nothing in it yet'
          : `${buyable.length} available · ${rupees(total)}`
      }
      sections={buyerMenu({
        orders: myOrders,
        isSeller: seller !== null,
        cart: items.length,
        saved: saved.ok ? saved.data.count : 0,
      })}
      current="/cart"
      action={{ href: '/browse', label: 'Keep browsing' }}
    >
      <div className="flex flex-col gap-8">
        <BannerSlot slot="cart" />

        {/* A checkout that failed says why. Nearly always somebody else bought
            one of these first, and the buyer needs to know which. */}
        {error !== undefined && error !== '' && (
          <p
            role="alert"
            className="rounded-sm border border-ember/50 bg-ember/10 px-5 py-4 text-sm leading-relaxed text-slate"
          >
            {error} Nothing has been charged.
          </p>
        )}

        {items.length === 0 ? (
          <Empty action={{ href: '/browse', label: 'Find a date' }}>
            Your cart is empty. Search a date that means something to you, and add the notes that
            carry it.
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Tile label="In your cart" value={String(items.length)} />
              <Tile label="Still available" value={String(buyable.length)} accent />
              <Tile label="Total" value={rupees(total)} hint="available items only" />
            </div>

            {gone.length > 0 && (
              <p className="rounded-sm border border-ember/40 bg-ember/5 px-5 py-4 text-sm text-slate-dim">
                {gone.length} item{gone.length === 1 ? ' is' : 's are'} no longer for sale. Every
                note here is unique, so nothing is held for you until you buy it — someone else
                reached these first.
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li
                  key={item.listingId}
                  className={`flex flex-wrap items-center gap-4 rounded-sm border p-4 ${
                    item.available
                      ? 'border-sand-line bg-sand-raised'
                      : 'border-sand-line bg-sand-raised opacity-60'
                  }`}
                >
                  {item.imageUrl !== null ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      className="h-16 w-24 shrink-0 rounded-sm border border-sand-line object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-sand-line text-[10px] text-slate-dim">
                      No photo
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <a
                      href={`/listing/${item.listingId}`}
                      className="font-mono text-sm text-slate underline-offset-4 hover:underline"
                    >
                      {item.serialDigits ?? item.title}
                    </a>
                    <p className="mt-1 text-xs text-slate-dim">
                      {item.denomination !== null && `₹${item.denomination} · `}
                      {item.grade ?? 'ungraded'} · from {item.sellerName}
                    </p>
                    {!item.available && (
                      <p className="mt-1 text-xs text-ember">No longer for sale</p>
                    )}
                  </div>

                  <span className="font-display text-xl tabular-nums text-slate">
                    {item.priceInr === null ? '—' : rupees(item.priceInr)}
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    {item.available && (
                      <form action={buyNow}>
                        <input type="hidden" name="listingId" value={item.listingId} />
                        <button
                          type="submit"
                          className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                        >
                          Buy this
                        </button>
                      </form>
                    )}
                    <form action={saveForLater}>
                      <input type="hidden" name="listingId" value={item.listingId} />
                      <button
                        type="submit"
                        className="rounded-full border border-sand-line px-4 py-2 text-xs text-slate-dim transition-colors hover:border-accent-deep hover:text-slate"
                      >
                        Save
                      </button>
                    </form>
                    <form action={removeFromCart}>
                      <input type="hidden" name="listingId" value={item.listingId} />
                      <button
                        type="submit"
                        className="rounded-full border border-sand-line px-4 py-2 text-xs text-slate-dim transition-colors hover:border-ember hover:text-ember"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>

            <form
              action={checkoutCart}
              className="rounded-sm border border-sand-line bg-sand-raised p-5"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                What you will be charged
              </p>

              {/* Every line separately, so nothing on the total is a surprise. */}
              <dl className="mt-4 flex flex-col gap-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-dim">
                    {buyable.length} item{buyable.length === 1 ? '' : 's'}
                    {sellerCount > 1 && ` from ${sellerCount} sellers`}
                  </dt>
                  <dd className="tabular-nums text-slate">{rupees(total)}</dd>
                </div>

                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-dim">
                    Delivery
                    {!freeDelivery && sellerCount > 1 && (
                      <span className="text-xs"> · ₹60 per seller, each posts separately</span>
                    )}
                  </dt>
                  <dd className="tabular-nums text-slate">
                    {freeDelivery ? (
                      <span className="text-accent-deep">Free</span>
                    ) : (
                      rupees(delivery)
                    )}
                  </dd>
                </div>

                {!freeDelivery && (
                  <p className="text-xs text-slate-dim">
                    Free above {rupees(FREE_DELIVERY_ABOVE)} — {rupees(FREE_DELIVERY_ABOVE - total)}{' '}
                    more to go.
                  </p>
                )}
              </dl>

              {/* Optional extras, each priced before it is chosen. */}
              <fieldset className="mt-5 flex flex-col gap-3 border-t border-sand-line pt-4">
                <legend className="sr-only">Optional extras</legend>

                <label className="flex items-start gap-3">
                  <input type="checkbox" name="insurance" value="yes" className="mt-1" />
                  <span>
                    <span className="block text-sm text-slate">
                      Insure the parcel — {rupees(Math.max(Math.round(total * 0.005), 25))}
                    </span>
                    <span className="block text-xs leading-relaxed text-slate-dim">
                      0.5% of the value, minimum ₹25. Covers loss or damage in transit against the
                      value declared here.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3">
                  <input type="checkbox" name="giftPacking" value="yes" className="mt-1" />
                  <span>
                    <span className="block text-sm text-slate">Gift packaging — ₹149</span>
                    <span className="block text-xs leading-relaxed text-slate-dim">
                      A box and a card rather than a padded envelope.
                    </span>
                  </span>
                </label>
              </fieldset>

              <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-sand-line pt-4">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                    Coupon code
                  </span>
                  <input
                    name="coupon"
                    maxLength={32}
                    placeholder="If you have one"
                    className="rounded-sm border border-sand-line bg-sand px-3 py-2 font-mono text-sm uppercase text-slate"
                  />
                </label>
                <button
                  type="submit"
                  disabled={buyable.length === 0}
                  className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-cream transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Checkout
                </button>
              </div>

              <p className="mt-4 border-t border-sand-line pt-4 text-sm leading-relaxed text-slate-dim">
                The exact total, with any discount applied, is shown before you pay — nothing is
                charged from this page. You pay once, however many sellers are in the basket, and
                your money is held until each note reaches you and the{' '}
                <a href="/refunds" className="text-accent-deep underline underline-offset-4">
                  inspection window
                </a>{' '}
                closes.
                {unavailable > 0 &&
                  ` ${unavailable} item${unavailable === 1 ? '' : 's'} in this basket ${unavailable === 1 ? 'is' : 'are'} no longer available and will not be charged for.`}
              </p>
            </form>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
