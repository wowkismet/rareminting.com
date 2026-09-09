import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { DashboardShell } from '@/components/DashboardShell.tsx';
import { Panel } from '@/components/DashboardPanels.tsx';
import { PayButton } from '@/components/PayButton.tsx';
import { api } from '@/lib/api.ts';
import { buyerMenu } from '@/lib/buyer-dashboard.ts';
import { currentSeller, currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Pay', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

interface Group {
  group: {
    id: string;
    groupNumber: string;
    deliveryInr: number;
    insuranceInr: number;
    giftPackingInr: number;
    discountInr: number;
    totalInr: number;
    placedAt: string | null;
    /** Null on groups placed before an address was asked for. */
    billTo: {
      name: string;
      line1: string | null;
      line2: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
      phone: string | null;
    } | null;
  };
  orders: {
    id: string;
    orderNumber: string;
    state: string;
    seller: string;
    totalInr: number;
    items: { listingId: string; title: string; serialDigits: string | null; priceInr: number }[];
  }[];
}

const PAID = ['paid', 'packed', 'shipped', 'delivered', 'inspection', 'completed'];

/**
 * One payment for a whole basket.
 *
 * Broken down by seller, because that is how it will actually be fulfilled —
 * three sellers means three parcels arriving separately, and a buyer who is
 * not told that will write in on the day two of them turn up.
 */
export default async function PayGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [seller, result] = await Promise.all([
    currentSeller(),
    api<Group>(`/v1/order-groups/${id}`, { token }),
  ]);
  if (!result.ok) notFound();

  const { group, orders } = result.data;
  const settled = orders.every((o) => PAID.includes(o.state));
  const items = orders.reduce((n, o) => n + o.items.length, 0);

  // The notes alone, worked back from what each seller's part came to. Shown
  // as its own line so the extras are visibly extras.
  const notesTotal = orders.reduce(
    (sum, o) => sum + o.items.reduce((n, i) => n + i.priceInr, 0),
    0,
  );

  return (
    <DashboardShell
      user={user}
      eyebrow={group.groupNumber}
      title={settled ? 'Paid' : 'One payment for everything'}
      subtitle={`${items} item${items === 1 ? '' : 's'} from ${orders.length} seller${orders.length === 1 ? '' : 's'}`}
      sections={buyerMenu({ orders: 0, isSeller: seller !== null })}
      current="/cart"
    >
      <div className="flex max-w-3xl flex-col gap-6">
        {/* Who the bill is made out to and where the parcel goes — the same
            name and address, as the buyer gave them. Shown before the total
            rather than after it, because this is the last point at which a
            wrong PIN code is free to fix. */}
        {group.billTo !== null && (
          <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
              Billed and delivered to
            </p>
            <address className="mt-3 text-sm not-italic leading-relaxed text-slate">
              <span className="block font-medium">{group.billTo.name}</span>
              <span className="block text-slate-dim">
                {group.billTo.line1}
                {group.billTo.line2 !== null && group.billTo.line2 !== '' && (
                  <>, {group.billTo.line2}</>
                )}
                <br />
                {group.billTo.city}, {group.billTo.state} {group.billTo.postalCode}
                {group.billTo.phone !== null && (
                  <>
                    <br />
                    {group.billTo.phone}
                  </>
                )}
              </span>
            </address>
            <p className="mt-3 text-xs leading-relaxed text-slate-dim">
              The bill for this order is issued in this name and to this address only. Change it
              from{' '}
              <a href="/cart" className="text-accent-deep underline underline-offset-4">
                your cart
              </a>{' '}
              before paying — once payment is taken, the invoice is fixed as it stands here.
            </p>
          </div>
        )}

        {orders.map((o) => (
          <Panel key={o.id} title={o.seller}>
            <ul className="flex flex-col gap-2">
              {o.items.map((i) => (
                <li
                  key={i.listingId}
                  className="flex items-baseline justify-between gap-3 border-b border-sand-line pb-2 text-sm last:border-0"
                >
                  <a
                    href={`/listing/${i.listingId}`}
                    className="font-mono text-xs text-slate underline-offset-4 hover:underline"
                  >
                    {i.serialDigits ?? i.title}
                  </a>
                  <span className="tabular-nums text-slate">{rupees(i.priceInr)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-dim">Their part, dispatched separately</span>
              <span className="tabular-nums text-slate">{rupees(o.totalInr)}</span>
            </p>
          </Panel>
        ))}

        <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
          {/* The bill, line by line. A total nobody can take apart is a total
              somebody writes in about. */}
          <dl className="mb-4 flex flex-col gap-2 border-b border-sand-line pb-4 text-sm">
            {(
              [
                ['Notes', notesTotal, false],
                ['Delivery', group.deliveryInr, false],
                ['Insurance', group.insuranceInr, false],
                ['Gift packaging', group.giftPackingInr, false],
                ['Discount', -group.discountInr, true],
              ] as const
            )
              .filter(([label, value]) => value !== 0 || label === 'Notes' || label === 'Delivery')
              .map(([label, value, isDiscount]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-dim">{label}</dt>
                  <dd className={`tabular-nums ${isDiscount ? 'text-accent-deep' : 'text-slate'}`}>
                    {label === 'Delivery' && value === 0 ? 'Free' : rupees(value)}
                  </dd>
                </div>
              ))}
          </dl>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-dim">
                Total, charged once
              </p>
              <p className="mt-1 font-display text-3xl tabular-nums text-slate">
                {rupees(group.totalInr)}
              </p>
            </div>

            {settled ? (
              <p className="font-mono text-xs uppercase tracking-wider text-accent-deep">
                Payment received
              </p>
            ) : (
              <PayButton
                groupId={group.id}
                amountInr={group.totalInr}
                buyerName={user.fullName}
                buyerEmail={user.email}
                label={`Pay ${rupees(group.totalInr)}`}
              />
            )}
          </div>

          <p className="mt-4 border-t border-sand-line pt-4 text-sm leading-relaxed text-slate-dim">
            One charge covers everything above. Each seller dispatches their own parcel, so more
            than one may arrive on different days. Your money is held until each reaches you and
            its{' '}
            <a href="/refunds" className="text-accent-deep underline underline-offset-4">
              inspection window
            </a>{' '}
            closes — sellers are paid after delivery, not before.
          </p>
        </div>

        <p className="text-sm text-slate-dim">
          Everything here is now reserved for you and off the market.{' '}
          <a href="/orders" className="text-accent-deep underline underline-offset-4">
            Your orders
          </a>{' '}
          shows each one once payment clears.
        </p>
      </div>
    </DashboardShell>
  );
}
