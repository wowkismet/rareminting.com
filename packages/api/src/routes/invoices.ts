/**
 * The invoice, and the delivery label that goes with it.
 *
 * One endpoint serving three readers, because the document is the same
 * document — a buyer, the seller and staff looking at one order should not be
 * shown three subtly different versions of what was charged, or a dispute
 * becomes an argument about whose copy is right.
 *
 * What does differ is the seller's own deductions. Commission, GST on it and
 * TDS are between the platform and the seller; a buyer has no business seeing
 * what the marketplace takes from the other side, so those appear only for the
 * seller and for staff. That split already exists on GET /v1/orders/:id and is
 * kept identical here on purpose.
 *
 * Everything is read from the order's own snapshot rather than joined live:
 * the billing name and address are as they were on the day, prices are as
 * charged, and the frame is the one that was bought. An invoice that changed
 * when somebody moved house or a price was edited would not be an invoice.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { notFound, unauthorized } from '../errors.ts';
import { one, type Database } from '../db.ts';

/** States in which an order has actually been paid for. */
const BILLABLE = ['paid', 'packed', 'shipped', 'delivered', 'inspection', 'completed'];

interface InvoiceRow {
  id: string;
  order_number: string;
  state: string;
  created_at: string;
  buyer_id: string | null;
  seller_user_id: string;
  seller_name: string;
  seller_legal_name: string | null;
  seller_gstin: string | null;
  subtotal_paise: string;
  shipping_paise: string;
  buyer_premium_paise: string;
  commission_paise: string;
  gst_on_commission_paise: string;
  tds_paise: string;
  total_paise: string;
  group_number: string | null;
  bill_to_name: string | null;
  bill_to_line1: string | null;
  bill_to_line2: string | null;
  bill_to_city: string | null;
  bill_to_state: string | null;
  bill_to_pin: string | null;
  bill_to_phone: string | null;
  buyer_email: string | null;
  awb: string | null;
  courier_name: string | null;
  shipment_status: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

export function registerInvoiceRoutes(router: Router, _database: Database): void {
  /**
   * GET /v1/orders/:id/invoice
   *
   * Readable by the buyer, the seller and staff. Anyone else is told the order
   * does not exist rather than that they may not see it — whose order this is
   * is not something a stranger needs confirmed.
   */
  router.add('GET', '/v1/orders/:id/invoice', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const row = one(
      await ctx.db.query<InvoiceRow>(
        `select o.id, o.order_number, o.state::text as state, o.created_at::text as created_at,
                o.subtotal_paise::text, o.shipping_paise::text, o.buyer_premium_paise::text,
                o.commission_paise::text, o.gst_on_commission_paise::text, o.tds_paise::text,
                o.total_paise::text,
                o.awb, o.courier_name, o.shipment_status,
                o.shipped_at::text as shipped_at, o.delivered_at::text as delivered_at,
                s.user_id as seller_user_id, s.display_name as seller_name,
                s.legal_name as seller_legal_name, s.gstin as seller_gstin,
                g.group_number, g.buyer_id,
                g.bill_to_name, g.bill_to_line1, g.bill_to_line2, g.bill_to_city,
                g.bill_to_state, g.bill_to_pin, g.bill_to_phone,
                u.email as buyer_email
           from orders o
           join sellers s on s.id = o.seller_id
           left join order_groups g on g.id = o.group_id
           left join users u on u.id = coalesce(g.buyer_id, o.buyer_id)
          where o.id = $1`,
        [id],
      ),
    );
    if (row === null) throw notFound('No such order.');

    const staff = await isStaff(ctx, session.userId);
    const isBuyer = row.buyer_id === session.userId;
    const isSeller = row.seller_user_id === session.userId;
    if (!isBuyer && !isSeller && !staff) throw notFound('No such order.');

    const items = await ctx.db.query<{
      title: string;
      listing_id: string;
      serial_digits: string | null;
      denomination: number | null;
      subtotal_paise: string;
      frame_name: string | null;
      frame_price_paise: string | null;
    }>(
      `select l.title, i.listing_id, n.serial_digits, n.denomination,
              i.subtotal_paise::text as subtotal_paise,
              i.frame_name, i.frame_price_paise::text as frame_price_paise
         from order_items i
         join listings l on l.id = i.listing_id
         left join notes n on n.listing_id = l.id
        where i.order_id = $1 and i.state <> 'cancelled'
        order by i.created_at`,
      [id],
    );

    const paise = (v: string | null): number => Number(v ?? 0);

    return json({
      invoice: {
        // Who is looking, so the page can label itself and decide what to
        // offer. Never used to decide what data to include — that is done
        // above, on the server, where it cannot be argued with.
        role: staff && !isBuyer && !isSeller ? 'admin' : isSeller ? 'seller' : 'buyer',
        canPrint: isSeller || staff,

        orderNumber: row.order_number,
        groupNumber: row.group_number,
        state: row.state,
        issuedAt: row.created_at,
        // An order still awaiting payment gets a proforma, not a tax invoice.
        // Calling an unpaid document an invoice is how a company ends up
        // accounting for revenue it never received.
        kind: BILLABLE.includes(row.state) ? 'invoice' : 'proforma',

        seller: {
          name: row.seller_name,
          legalName: row.seller_legal_name,
          gstin: row.seller_gstin,
        },

        /**
         * As written at checkout, not as the address book stands today. The
         * buyer may have moved since; the bill says what it said.
         */
        billTo:
          row.bill_to_name === null
            ? null
            : {
                name: row.bill_to_name,
                line1: row.bill_to_line1,
                line2: row.bill_to_line2,
                city: row.bill_to_city,
                state: row.bill_to_state,
                postalCode: row.bill_to_pin,
                phone: row.bill_to_phone,
                email: row.buyer_email,
              },

        items: items.rows.map((i) => ({
          title: i.title,
          listingId: i.listing_id,
          serialDigits: i.serial_digits,
          denomination: i.denomination,
          priceInr: paise(i.subtotal_paise) / 100,
          frameName: i.frame_name,
          frameInr: paise(i.frame_price_paise) / 100,
        })),

        charges: {
          subtotalInr: paise(row.subtotal_paise) / 100,
          shippingInr: paise(row.shipping_paise) / 100,
          buyerPremiumInr: paise(row.buyer_premium_paise) / 100,
          totalInr: paise(row.total_paise) / 100,
        },

        // The platform's cut, which is between it and the seller.
        ...(isSeller || staff
          ? {
              settlement: {
                commissionInr: paise(row.commission_paise) / 100,
                gstOnCommissionInr: paise(row.gst_on_commission_paise) / 100,
                tdsInr: paise(row.tds_paise) / 100,
                payoutInr:
                  (paise(row.subtotal_paise) -
                    paise(row.commission_paise) -
                    paise(row.gst_on_commission_paise) -
                    paise(row.tds_paise)) /
                  100,
              },
            }
          : {}),

        /**
         * What goes on the delivery label. The AWB is the barcode a courier
         * scans; until one exists the order number is barcoded instead, which
         * is what the packing slip is filed under.
         */
        delivery: {
          awb: row.awb,
          courierName: row.courier_name,
          status: row.shipment_status,
          shippedAt: row.shipped_at,
          deliveredAt: row.delivered_at,
          barcode: row.awb ?? row.order_number,
          barcodeIs: row.awb === null ? 'order' : 'awb',
        },
      },
    });
  });
}

async function isStaff(ctx: Ctx, userId: string): Promise<boolean> {
  const rows = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 and role in ('admin', 'support')`,
    [userId],
  );
  return rows.rows.length > 0;
}
