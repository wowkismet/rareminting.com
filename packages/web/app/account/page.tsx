import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DashboardShell, Empty } from '@/components/DashboardShell.tsx';
import { Panel, QuickActions, StatCard } from '@/components/DashboardPanels.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu, type BasketResponse } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Your account' };
export const dynamic = 'force-dynamic';

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

interface BuyerDashboard {
  stats: {
    orders: number;
    ordersOpen: number;
    spentInr: number;
    cart: number;
    saved: number;
    collections: number;
    activeBids: number;
  };
  memberSince: string | null;
  bids: {
    auctionId: string;
    listingId: string;
    title: string;
    serialDigits: string | null;
    myMaxInr: number;
    currentInr: number | null;
    bidCount: number;
    endsAt: string;
    leading: boolean;
    imageUrl: string | null;
  }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    state: string;
    totalInr: number;
    title: string | null;
    imageUrl: string | null;
    createdAt: string;
  }[];
}

const ORDER_TONE: Record<string, string> = {
  payment_pending: 'text-ember',
  paid: 'text-accent-deep',
  shipped: 'text-accent-deep',
  delivered: 'text-accent-deep',
  completed: 'text-slate-dim',
  cancelled: 'text-slate-dim',
};

/** "Jan 2024", or nothing if the date will not parse. */
function monthYear(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** How long until an auction closes, in the coarsest unit that still informs. */
function closesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'closing';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

/**
 * The buyer's dashboard.
 *
 * What a buyer came for: what they have ordered, what they are still bidding
 * on, what they have put aside, and a route back to finding a date.
 *
 * There is no wallet, no points balance and no viewing history here. Not an
 * oversight — none of the three exists, and this is the page where an invented
 * figure would look most like the site telling somebody about their own money.
 */
export default async function AccountPage() {
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [seller, dash, saved] = await Promise.all([
    currentSeller(),
    api<BuyerDashboard>('/v1/me/dashboard', { token }),
    api<BasketResponse>('/v1/saved', { token }),
  ]);

  if (!dash.ok) redirect('/signin');
  const { stats, bids, recentOrders, memberSince } = dash.data;
  const savedItems = saved.ok ? saved.data.items : [];

  return (
    <DashboardShell
      user={user}
      eyebrow="The Vault"
      title={`Hello, ${user.fullName ?? user.email.split('@')[0]}`}
      subtitle={`Member since ${monthYear(memberSince)}`}
      sections={buyerMenu({
        orders: stats.orders,
        isSeller: seller !== null,
        cart: stats.cart,
        saved: stats.saved,
      })}
      current="/account"
      action={{ href: '/browse', label: 'Find a date' }}
    >
      <div className="flex flex-col gap-6">
        {!user.emailVerified && (
          <p className="rounded-sm border border-accent-deep/40 bg-sand-raised px-5 py-4 text-sm text-slate-dim">
            Your email address is not verified yet. Verification emails are not switched on — it
            does not limit anything you can do today.
          </p>
        )}

        {/* Headline figures */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Total orders"
            value={String(stats.orders)}
            hint={stats.ordersOpen === 0 ? 'none in flight' : `${stats.ordersOpen} in flight`}
            accent
          />
          <StatCard
            label="Active bids"
            value={String(stats.activeBids)}
            hint="on auctions still running"
          />
          <StatCard label="Saved items" value={String(stats.saved)} hint="put aside for later" />
          <StatCard label="Collections" value={String(stats.collections)} hint="yours" />
          <StatCard
            label="Spent"
            value={rupees(stats.spentInr)}
            hint="excluding cancellations"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Recent orders" action={{ href: '/orders', label: 'View all' }}>
            {recentOrders.length === 0 ? (
              <Empty action={{ href: '/browse', label: 'Find a date' }}>
                Nothing ordered yet. Search for a date that means something to you and the notes
                carrying it will come up.
              </Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {recentOrders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3">
                    {o.imageUrl !== null ? (
                      <img
                        src={o.imageUrl}
                        alt=""
                        className="h-10 w-14 shrink-0 rounded-sm border border-sand-line object-cover"
                      />
                    ) : (
                      <div className="h-10 w-14 shrink-0 rounded-sm border border-dashed border-sand-line" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/orders/${o.id}`}
                        className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                      >
                        {o.orderNumber}
                      </a>
                      <p className="mt-0.5 truncate text-xs text-slate-dim">
                        {o.title ?? '—'} · {o.createdAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums text-sm text-slate">{rupees(o.totalInr)}</p>
                      <p
                        className={`text-[10px] uppercase tracking-wider ${ORDER_TONE[o.state] ?? 'text-slate-dim'}`}
                      >
                        {o.state.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Auctions you are bidding on" action={{ href: '/auctions', label: 'All auctions' }}>
            {bids.length === 0 ? (
              <Empty action={{ href: '/auctions', label: 'See what is running' }}>
                You have no live bids. A bid here shows whether you are still the one to beat, and
                how long is left.
              </Empty>
            ) : (
              <ul className="flex flex-col gap-3">
                {bids.map((b) => (
                  <li key={b.auctionId} className="flex items-center gap-3">
                    {b.imageUrl !== null ? (
                      <img
                        src={b.imageUrl}
                        alt=""
                        className="h-10 w-14 shrink-0 rounded-sm border border-sand-line object-cover"
                      />
                    ) : (
                      <div className="h-10 w-14 shrink-0 rounded-sm border border-dashed border-sand-line" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/auctions/${b.auctionId}`}
                        className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                      >
                        {b.serialDigits ?? b.title}
                      </a>
                      <p className="mt-0.5 text-xs text-slate-dim">
                        {b.currentInr === null ? 'no bids yet' : `at ${rupees(b.currentInr)}`} ·{' '}
                        {closesIn(b.endsAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] uppercase tracking-wider ${
                        b.leading ? 'text-accent-deep' : 'text-ember'
                      }`}
                    >
                      {b.leading ? 'leading' : 'outbid'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <QuickActions
          actions={[
            { href: '/browse', label: 'Find a date', icon: '🔍' },
            { href: '/auctions', label: 'Auctions', icon: '⚖' },
            { href: '/cart', label: 'Cart', icon: '🛒' },
            { href: '/saved', label: 'Saved', icon: '♡' },
            { href: '/orders', label: 'Orders', icon: '▦' },
            { href: '/contact', label: 'Help', icon: '☎' },
          ]}
        />

        <Panel title="Saved for later" action={{ href: '/saved', label: 'View all' }}>
          {savedItems.length === 0 ? (
            <Empty action={{ href: '/browse', label: 'Find a date' }}>
              Nothing saved yet. Saving a note puts it aside without taking it off the market —
              somebody else can still buy it, so the list says when one has gone.
            </Empty>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {savedItems.slice(0, 4).map((item) => (
                <li
                  key={item.listingId}
                  className="rounded-sm border border-sand-line bg-sand-raised p-3"
                >
                  {item.imageUrl !== null ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="mb-2 h-24 w-full rounded-sm object-cover"
                    />
                  ) : (
                    <div className="mb-2 h-24 w-full rounded-sm border border-dashed border-sand-line" />
                  )}
                  <a
                    href={`/listing/${item.listingId}`}
                    className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                  >
                    {item.serialDigits ?? item.title}
                  </a>
                  <p className="mt-1 text-xs text-slate-dim">
                    {item.priceInr === null ? '—' : rupees(item.priceInr)}
                  </p>
                  {!item.available && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-ember">
                      no longer available
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}
