import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PayButton } from '@/components/PayButton.tsx';
import { SiteHeader } from '@/components/SiteHeader.tsx';
import { SiteFooter } from '@/components/SiteFooter.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = { title: 'Order', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface OrderDetail {
  id: string;
  orderNumber: string;
  state: string;
  title: string;
  serialDigits: string | null;
  role: string;
  subtotalInr: number;
  shippingInr: number;
  buyerPremiumInr: number;
  totalInr: number;
  commissionInr?: number;
  gstOnCommissionInr?: number;
  tdsInr?: number;
  payoutInr?: number;
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'border-t border-sand-line pt-3' : ''}`}
    >
      <dt className={strong ? 'text-slate' : 'text-slate-dim'}>{label}</dt>
      <dd
        className={`tabular-nums ${strong ? 'font-display text-xl text-slate' : 'text-slate'}`}
      >
        {value}
      </dd>
    </div>
  );
}

const inr = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (user === null) redirect('/signin');
  const token = await sessionToken();

  const result = await api<{ order: OrderDetail }>(`/v1/orders/${id}`, { token });
  if (!result.ok) notFound();
  const order = result.data.order;
  const isSeller = order.role === 'seller';

  return (
    <div>
      <SiteHeader user={user} compact />

      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-5 py-14">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent-deep">
            {order.orderNumber}
          </p>
          <h1 className="mt-2 font-display text-3xl text-slate">{order.title}</h1>
          <p className="mt-2 text-sm text-slate-dim">
            {isSeller ? 'You are the seller' : 'You are the buyer'}
            {order.serialDigits !== null && (
              <> · serial <span className="font-mono text-slate">{order.serialDigits}</span></>
            )}
          </p>
        </div>

        {order.state === 'payment_pending' && !isSeller && (
          <div className="rounded-sm border border-accent-deep/40 bg-sand-raised p-5">
            <p className="font-display text-lg text-slate">Pay for this order</p>
            <p className="mt-2 mb-5 text-sm leading-relaxed text-slate-dim">
              This note is reserved for you and off the market. Your payment is held until it
              reaches you and the{' '}
              <a href="/refunds" className="text-accent-deep underline underline-offset-4">
                inspection window
              </a>{' '}
              closes — the seller is not paid before then.
            </p>
            <PayButton
              orderId={order.id}
              amountInr={order.totalInr}
              buyerName={user.fullName}
              buyerEmail={user.email}
            />
          </div>
        )}

        {order.state === 'payment_pending' && isSeller && (
          <div className="rounded-sm border border-sand-line bg-sand-raised p-5">
            <p className="font-display text-lg text-slate">Waiting for payment</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              The buyer has committed to this order and the note is off the market. Do not dispatch
              until the payment shows as received.
            </p>
          </div>
        )}

        {order.state === 'paid' && (
          <div className="rounded-sm border border-accent-deep/50 bg-accent-deep/10 p-5">
            <p className="font-display text-lg text-slate">Payment received</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-dim">
              {isSeller
                ? 'Payment has cleared. Dispatch the item, and your payout is released once the buyer has it and the inspection window closes.'
                : 'Your payment has cleared and we are holding it. The seller will dispatch shortly.'}
            </p>
          </div>
        )}

        <section>
          <h2 className="mb-1 font-display text-xl text-slate">
            {isSeller ? 'What you will receive' : 'What you pay'}
          </h2>
          <dl className="text-sm">
            <Row label="Item" value={inr(order.subtotalInr)} />
            {order.shippingInr > 0 && <Row label="Shipping" value={inr(order.shippingInr)} />}
            {order.buyerPremiumInr > 0 && (
              <Row label="Buyer's premium" value={inr(order.buyerPremiumInr)} />
            )}

            {isSeller ? (
              <>
                <Row label="Platform commission" value={`− ${inr(order.commissionInr ?? 0)}`} />
                <Row
                  label="GST on commission"
                  value={`− ${inr(order.gstOnCommissionInr ?? 0)}`}
                />
                <Row label="TDS withheld (194-O)" value={`− ${inr(order.tdsInr ?? 0)}`} />
                <Row label="Your payout" value={inr(order.payoutInr ?? 0)} strong />
              </>
            ) : (
              <Row label="Total" value={inr(order.totalInr)} strong />
            )}
          </dl>
        </section>

        <a href="/orders" className="text-sm text-accent-deep underline underline-offset-4">
          Back to orders
        </a>
      </main>

      <SiteFooter />
    </div>
  );
}
