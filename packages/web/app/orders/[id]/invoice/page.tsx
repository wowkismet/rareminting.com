import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { COMPANY, formattedAddress, registrationLine } from '@rareminting/config';

import { Barcode } from '@/components/Barcode.tsx';
import { PrintButton } from '@/components/PrintButton.tsx';
import { Tracking, type TrackingData } from '@/components/Tracking.tsx';
import { api } from '@/lib/api.ts';
import { currentUser, sessionToken } from '@/lib/session.ts';

export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

interface Invoice {
  role: 'buyer' | 'seller' | 'admin';
  canPrint: boolean;
  orderNumber: string;
  groupNumber: string | null;
  state: string;
  issuedAt: string;
  kind: 'invoice' | 'proforma';
  seller: { name: string; legalName: string | null; gstin: string | null };
  billTo: {
    name: string;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  items: {
    title: string;
    listingId: string;
    serialDigits: string | null;
    denomination: number | null;
    priceInr: number;
    frameName: string | null;
    frameInr: number;
  }[];
  charges: {
    subtotalInr: number;
    shippingInr: number;
    buyerPremiumInr: number;
    totalInr: number;
  };
  settlement?: {
    commissionInr: number;
    gstOnCommissionInr: number;
    tdsInr: number;
    payoutInr: number;
  };
  delivery: {
    awb: string | null;
    courierName: string | null;
    status: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    barcode: string;
    barcodeIs: 'awb' | 'order';
  };
}

const rupees = (n: number): string => `₹${n.toLocaleString('en-IN')}`;

const day = (iso: string | null): string =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

/**
 * The invoice, and the delivery label beside it.
 *
 * One page for the buyer, the seller and staff. The API decides what each may
 * see — the platform's own cut is between it and the seller — and this renders
 * whatever came back rather than deciding for itself. A page that filtered by
 * role in the browser would be one `view-source` away from leaking it.
 *
 * Laid out for A4 first and the screen second. The site's dark navy is
 * deliberately absent: it is a document, it will be printed, and a page that
 * empties a toner cartridge is a page nobody prints twice.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (user === null) redirect('/signin');

  const token = await sessionToken();
  const [result, trackingResult] = await Promise.all([
    api<{ invoice: Invoice }>(`/v1/orders/${id}/invoice`, { token }),
    api<TrackingData>(`/v1/orders/${id}/tracking`, { token }),
  ]);
  if (!result.ok) notFound();
  const tracking = trackingResult.ok ? trackingResult.data : null;

  const inv = result.data.invoice;
  const framed = inv.items.filter((i) => i.frameName !== null);
  const frameTotal = framed.reduce((sum, i) => sum + i.frameInr, 0);

  return (
    <main className="invoice-sheet mx-auto max-w-[210mm] bg-white p-8 text-[13px] text-black sm:p-12">
      {/* Kept out of print. Neither the navigation back nor the button that
          opened the dialog belongs on the paper. */}
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3">
        <a href={`/orders/${id}`} className="text-sm text-slate underline underline-offset-4">
          ← Back to the order
        </a>
        {inv.canPrint && <PrintButton />}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-black pb-6">
        <div>
          {/* The wordmark set as type rather than pulled in as the site
              component: the masthead version is accent cyan, which prints as
              a pale wash. */}
          <p
            className="font-display text-2xl font-semibold uppercase tracking-[0.12em]"
            style={{ color: '#000' }}
          >
            Rareminting
          </p>
          <p className="mt-0.5 font-display text-[10px] uppercase tracking-[0.3em]">
            Tells your story
          </p>
          <p className="mt-3 text-[11px] leading-relaxed">
            {COMPANY.legalName}
            <br />
            {formattedAddress()}
            <br />
            {registrationLine()}
          </p>
        </div>

        <div className="text-right">
          <p className="font-display text-xl uppercase tracking-[0.2em]">
            {inv.kind === 'invoice' ? 'Invoice' : 'Proforma'}
          </p>
          <p className="mt-2 font-mono text-sm">{inv.orderNumber}</p>
          <p className="mt-1 text-[11px]">Issued {day(inv.issuedAt)}</p>
          {inv.groupNumber !== null && (
            <p className="mt-1 text-[11px]">Basket {inv.groupNumber}</p>
          )}
          {inv.kind === 'proforma' && (
            <p className="mt-2 max-w-[38ch] text-[10px] leading-relaxed">
              Not a tax invoice. This order has not been paid for.
            </p>
          )}
        </div>
      </header>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]">Billed and delivered to</p>
          {inv.billTo === null ? (
            <p className="mt-2 text-[12px] leading-relaxed">
              No address was recorded against this order.
            </p>
          ) : (
            <address className="mt-2 not-italic text-[12px] leading-relaxed">
              {inv.billTo.name}
              <br />
              {inv.billTo.line1}
              {inv.billTo.line2 !== null && inv.billTo.line2 !== '' && (
                <>
                  <br />
                  {inv.billTo.line2}
                </>
              )}
              <br />
              {inv.billTo.city}, {inv.billTo.state} {inv.billTo.postalCode}
              {inv.billTo.phone !== null && (
                <>
                  <br />
                  {inv.billTo.phone}
                </>
              )}
            </address>
          )}
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]">Sold by</p>
          <p className="mt-2 text-[12px] leading-relaxed">
            {inv.seller.legalName ?? inv.seller.name}
            {inv.seller.gstin !== null && (
              <>
                <br />
                GSTIN {inv.seller.gstin}
              </>
            )}
            <br />
            <span className="text-[11px]">
              Sold through the {COMPANY.brand} marketplace, operated by {COMPANY.legalName}.
            </span>
          </p>
        </div>
      </section>

      <table className="mt-8 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-black">
            <th className="py-2 text-left font-mono text-[10px] uppercase tracking-wider">Item</th>
            <th className="py-2 text-right font-mono text-[10px] uppercase tracking-wider">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((item) => (
            <tr key={item.listingId} className="border-b border-black/20 align-top">
              <td className="py-3 pr-4">
                <span className="font-listing">{item.title}</span>
                {item.serialDigits !== null && (
                  <>
                    <br />
                    <span className="font-mono text-[11px]">Serial {item.serialDigits}</span>
                  </>
                )}
                {item.frameName !== null && (
                  <>
                    <br />
                    <span className="text-[11px]">
                      Framed — {item.frameName} ({rupees(item.frameInr)})
                    </span>
                  </>
                )}
              </td>
              <td className="py-3 text-right font-listing tabular-nums">
                {rupees(item.priceInr + item.frameInr)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs text-[12px]">
          <Line label="Notes" value={rupees(inv.charges.subtotalInr)} />
          {frameTotal > 0 && <Line label="Framing" value={rupees(frameTotal)} />}
          {inv.charges.shippingInr > 0 && (
            <Line label="Delivery" value={rupees(inv.charges.shippingInr)} />
          )}
          {inv.charges.buyerPremiumInr > 0 && (
            <Line label="Buyer premium" value={rupees(inv.charges.buyerPremiumInr)} />
          )}
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-black pt-2">
            <dt className="font-mono text-[10px] uppercase tracking-[0.2em]">Total paid</dt>
            <dd className="font-listing text-lg tabular-nums">{rupees(inv.charges.totalInr)}</dd>
          </div>
        </dl>
      </section>

      {/* Between the platform and the seller. The API omits it entirely for a
          buyer, so this block simply never renders for them. */}
      {inv.settlement !== undefined && (
        <section className="mt-8 border-t border-black/30 pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]">Seller settlement</p>
          <dl className="mt-2 max-w-xs text-[12px]">
            <Line label="Sale value" value={rupees(inv.charges.subtotalInr)} />
            <Line label="Commission" value={`− ${rupees(inv.settlement.commissionInr)}`} />
            <Line label="GST on commission" value={`− ${rupees(inv.settlement.gstOnCommissionInr)}`} />
            <Line label="TDS (§194-O)" value={`− ${rupees(inv.settlement.tdsInr)}`} />
            <div className="mt-2 flex items-baseline justify-between border-t border-black pt-2">
              <dt className="font-mono text-[10px] uppercase tracking-[0.2em]">Payout</dt>
              <dd className="font-listing tabular-nums">{rupees(inv.settlement.payoutInr)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] leading-relaxed">
            Paid at the end of the inspection window, not on dispatch.
          </p>
        </section>
      )}

      {/* The delivery label. Page-broken before it on paper so it can be cut
          off and stuck to the parcel without the invoice going with it. */}
      <section className="delivery-label mt-10 border-2 border-black p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em]">Delivery label</p>
            <p className="mt-1 text-[11px]">
              {inv.delivery.barcodeIs === 'awb'
                ? `${inv.delivery.courierName ?? 'Courier'} · AWB`
                : 'Not yet booked with a courier — this is the order number'}
            </p>
          </div>
          {inv.delivery.status !== null && (
            <p className="font-mono text-[11px] uppercase">{inv.delivery.status}</p>
          )}
        </div>

        <div className="mt-4">
          <Barcode value={inv.delivery.barcode} height={64} moduleWidth={2} />
        </div>

        {inv.billTo !== null && (
          <address className="mt-4 not-italic text-[12px] leading-relaxed">
            <span className="font-semibold">{inv.billTo.name}</span>
            <br />
            {inv.billTo.line1}
            {inv.billTo.line2 !== null && inv.billTo.line2 !== '' && `, ${inv.billTo.line2}`}
            <br />
            {inv.billTo.city}, {inv.billTo.state} {inv.billTo.postalCode}
            {inv.billTo.phone !== null && (
              <>
                <br />
                {inv.billTo.phone}
              </>
            )}
          </address>
        )}
      </section>

      {tracking !== null && (
        <section className="no-print mt-8">
          <Tracking tracking={tracking} />
        </section>
      )}

      <footer className="mt-8 border-t border-black/30 pt-4 text-[10px] leading-relaxed">
        {COMPANY.brand} is a brand of {COMPANY.legalName}. Every note sold here is a numismatic
        collectible offered at a collector&rsquo;s premium, not currency exchange.{' '}
        {COMPANY.supportEmail !== null && <>Questions: {COMPANY.supportEmail}.</>}
      </footer>
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt>{label}</dt>
      <dd className="font-listing tabular-nums">{value}</dd>
    </div>
  );
}
