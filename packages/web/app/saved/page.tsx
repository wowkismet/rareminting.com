import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { moveSavedToCart, removeFromSaved } from '@/app/actions.ts';
import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu, type BasketResponse } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Saved for later' };
export const dynamic = 'force-dynamic';

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

/**
 * Notes kept to come back to.
 *
 * Unlike the cart, a saved item survives the note being sold — a collector
 * watching a type wants to know what comparable examples went for, and losing
 * that history the moment somebody else buys would throw away the useful part.
 */
export default async function SavedPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [saved, cart, orders, seller] = await Promise.all([
    api<BasketResponse>('/v1/saved', { token }),
    api<BasketResponse>('/v1/cart', { token }),
    api<{ orders: { role: string }[] }>('/v1/orders', { token }),
    currentSeller(),
  ]);

  const items = saved.ok ? saved.data.items : [];
  const myOrders = orders.ok ? orders.data.orders.filter((o) => o.role !== 'seller').length : 0;

  return (
    <DashboardShell
      user={user}
      eyebrow="The Vault"
      title="Saved for later"
      subtitle={
        items.length === 0
          ? 'Nothing saved yet'
          : `${items.length} saved · ${saved.ok ? saved.data.availableCount : 0} still for sale`
      }
      sections={buyerMenu({
        orders: myOrders,
        isSeller: seller !== null,
        cart: cart.ok ? cart.data.count : 0,
        saved: items.length,
      })}
      current="/saved"
      action={{ href: '/browse', label: 'Find a date' }}
    >
      {items.length === 0 ? (
        <Empty action={{ href: '/browse', label: 'Browse notes' }}>
          Nothing saved. Use <span className="text-slate">Save for later</span> on any note you
          want to think about — it stays here even if somebody else buys it, so you can see what it
          went for.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.listingId}
              className="flex flex-wrap items-center gap-4 rounded-sm border border-sand-line bg-sand-raised p-4"
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
                {item.note !== undefined && (
                  <p className="mt-1 text-xs italic text-slate">{item.note}</p>
                )}
                {!item.available && <p className="mt-1 text-xs text-ember">Sold</p>}
              </div>

              <span className="font-display text-xl tabular-nums text-slate">
                {item.priceInr === null ? '—' : rupees(item.priceInr)}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {item.available && (
                  <form action={moveSavedToCart}>
                    <input type="hidden" name="listingId" value={item.listingId} />
                    <button
                      type="submit"
                      className="rounded-full bg-primary px-5 py-2 text-xs font-medium text-cream transition-colors hover:bg-secondary"
                    >
                      Move to cart
                    </button>
                  </form>
                )}
                <form action={removeFromSaved}>
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
      )}
    </DashboardShell>
  );
}
