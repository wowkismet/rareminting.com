/**
 * Checking out a whole basket.
 *
 * One payment, whatever is in the cart and however many sellers it spans.
 * That is the promise in section 4A of the operations document, and it is the
 * difference between a marketplace and a row of separate shops.
 *
 * The shape underneath:
 *
 *   order_groups   what the buyer pays for, once
 *     └── orders          one seller's part -- one payout, one shipment
 *           └── order_items    one listing
 *
 * Reservation is all-or-nothing. Every listing in the basket is taken off the
 * market inside one transaction, and if any of them has gone in the meantime
 * the whole thing rolls back and the buyer is told which. The alternative --
 * charging for four of five items and apologising for the fifth -- is worse
 * than failing, because every item here is one of a kind and there is no
 * second one to send.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, unauthorized } from '../errors.ts';
import { asObject } from '../validate.ts';
import { one, type Database } from '../db.ts';
import { computeBreakdown, DEFAULT_RATES, type Rates } from '../money.ts';
import { computeCharges } from '../charges.ts';
import { checkCoupon } from './coupons.ts';

interface CartRow {
  listing_id: string;
  seller_id: string;
  seller_kind: string;
  title: string;
  serial_digits: string | null;
  price_paise: string | null;
  state: string;
}

/** Human-facing reference. Short enough to read down a phone line. */
function reference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `${prefix}-${stamp}-${noise}`;
}

/** What a listing is called when telling somebody it has gone. */
const nameOf = (r: { serial_digits: string | null; title: string }): string =>
  r.serial_digits ?? r.title;

export function registerCheckoutRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/cart/checkout — turn the basket into one payable group.
   *
   * Idempotent in the way that matters: it reserves before it charges, so a
   * double submit finds the listings already reserved and fails the second
   * attempt rather than creating a second order for the same notes.
   */
  router.add('POST', '/v1/cart/checkout', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const buyerId = ctx.session.userId;

    const options = asObject(await ctx.body());
    const wantsInsurance = options['insurance'] === true;
    const wantsGiftPacking = options['giftPacking'] === true;
    const couponCode =
      typeof options['coupon'] === 'string' && options['coupon'].trim() !== ''
        ? options['coupon'].trim()
        : null;

    // Where it is going, settled before any money moves. Until now a buyer
    // could pay without ever saying where to send the parcel, which left
    // support chasing an address after the fact on every single order.
    //
    // The chosen one if the cart sent one, otherwise their default — the same
    // rule the single-listing buy route follows, so the two cannot disagree
    // about where a note goes. Either way the id is matched against the
    // buyer's own rows, so a swapped id in the request reaches nothing.
    const addressId = typeof options['addressId'] === 'string' ? options['addressId'] : '';
    const address = one(
      await ctx.db.query<{
        id: string;
        recipient_name: string;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        postal_code: string;
        phone_e164: string | null;
      }>(
        `select id, recipient_name, line1, line2, city, state, postal_code, phone_e164
           from addresses
          where user_id = $1 and kind = 'shipping'
            and ($2::uuid is null or id = $2::uuid)
          order by is_default desc, created_at desc
          limit 1`,
        [buyerId, /^[0-9a-f-]{36}$/i.test(addressId) ? addressId : null],
      ),
    );
    if (address === null) {
      throw badRequest('Choose a delivery address before paying.', { addressId: 'required' });
    }

    const cart = await ctx.db.query<CartRow>(
      `select c.listing_id, l.seller_id, s.kind as seller_kind, l.title,
              n.serial_digits, l.price_paise::text as price_paise, l.state
         from cart_items c
         join listings l on l.id = c.listing_id
         join sellers  s on s.id = l.seller_id
         left join notes n on n.listing_id = l.id
        where c.buyer_id = $1
        order by c.added_at asc`,
      [buyerId],
    );

    if (cart.rows.length === 0) {
      throw conflict('Your cart is empty.');
    }

    // Say everything that is wrong at once. Telling a buyer about one problem,
    // waiting for them to fix it and then telling them about the next is how a
    // checkout gets abandoned.
    const gone = cart.rows.filter((r) => r.state !== 'minted');
    if (gone.length > 0) {
      throw conflict(
        gone.length === 1
          ? `${nameOf(gone[0]!)} is no longer available. Remove it to continue.`
          : `${gone.length} items are no longer available: ${gone.map(nameOf).join(', ')}. Remove them to continue.`,
      );
    }

    const unpriced = cart.rows.filter((r) => r.price_paise === null);
    if (unpriced.length > 0) {
      throw conflict(
        `${unpriced.map(nameOf).join(', ')} has no price and cannot be bought here.`,
      );
    }

    // One rate lookup per seller kind rather than per line.
    const kinds = [...new Set(cart.rows.map((r) => r.seller_kind))];
    const rates = new Map<string, Rates>();
    for (const kind of kinds) {
      const found = await ctx.db.query<{
        take_rate_bps: number;
        listing_fee_paise: string;
        buyer_premium_bps: number;
        gst_rate_bps: number;
        tds_rate_bps: number;
      }>(
        `select take_rate_bps, listing_fee_paise::text, buyer_premium_bps,
                gst_rate_bps, tds_rate_bps
           from commission_rules
          where (seller_kind is null or seller_kind = $1::seller_kind)
            and effective_from <= current_date
            and (effective_to is null or effective_to >= current_date)
          order by seller_kind nulls last, effective_from desc
          limit 1`,
        [kind],
      );
      const row = found.rows[0];
      rates.set(
        kind,
        row === undefined
          ? DEFAULT_RATES
          : {
              takeRateBps: row.take_rate_bps,
              listingFeePaise: Number(row.listing_fee_paise),
              buyerPremiumBps: row.buyer_premium_bps,
              gstRateBps: row.gst_rate_bps,
              tdsRateBps: row.tds_rate_bps,
            },
      );
    }

    return database.transaction(async (tx) => {
      // Reserve every listing first. The `state = 'minted'` in the where
      // clause is the lock: two buyers racing for the same note, only one
      // update matches.
      for (const row of cart.rows) {
        const taken = await tx.query<{ id: string }>(
          `update listings set state = 'reserved'
            where id = $1 and state = 'minted'
            returning id`,
          [row.listing_id],
        );
        if (taken.rows.length === 0) {
          // Rolls back every reservation made above it.
          throw conflict(
            `${nameOf(row)} was bought by someone else a moment ago. Nothing has been charged.`,
          );
        }
      }

      // Per-seller totals, because each seller is paid separately even though
      // the buyer pays once.
      const bySeller = new Map<string, CartRow[]>();
      for (const row of cart.rows) {
        const list = bySeller.get(row.seller_id) ?? [];
        list.push(row);
        bySeller.set(row.seller_id, list);
      }

      let groupTotal = 0;
      const orders: { id: string; orderNumber: string; sellerId: string; totalPaise: number }[] = [];

      const group = await tx.query<{ id: string; group_number: string }>(
        // The address is stored twice on purpose: by reference, so "send it
        // here" still points at the book, and as text, so the invoice keeps
        // saying what it said on the day it was issued even after the buyer
        // moves house or deletes the entry.
        `insert into order_groups (group_number, buyer_id, total_paise, placed_at,
                                   shipping_address_id, bill_to_name, bill_to_line1,
                                   bill_to_line2, bill_to_city, bill_to_state,
                                   bill_to_pin, bill_to_phone)
         values ($1, $2, 1, now(), $3, $4, $5, $6, $7, $8, $9, $10)
         returning id, group_number`,
        [
          reference('RMG'),
          buyerId,
          address.id,
          address.recipient_name,
          address.line1,
          address.line2,
          address.city,
          address.state,
          address.postal_code,
          address.phone_e164,
        ],
      );
      const groupId = group.rows[0]!.id;

      for (const [sellerId, rows] of bySeller) {
        const r = rates.get(rows[0]!.seller_kind) ?? DEFAULT_RATES;

        const lines = rows.map((row) => ({
          row,
          money: computeBreakdown({ subtotalPaise: Number(row.price_paise), rates: r }),
        }));

        const sum = (pick: (m: (typeof lines)[number]['money']) => number): number =>
          lines.reduce((n, l) => n + pick(l.money), 0);

        const orderTotal = sum((m) => m.totalPaise);
        groupTotal += orderTotal;

        const created = await tx.query<{ id: string; order_number: string }>(
          `insert into orders
             (order_number, buyer_id, seller_id, listing_id, group_id, state,
              subtotal_paise, shipping_paise, buyer_premium_paise,
              commission_paise, gst_on_commission_paise, tds_paise, total_paise,
              placed_at)
           values ($1, $2, $3, $4, $5, 'payment_pending',
                   $6, $7, $8, $9, $10, $11, $12, now())
           returning id, order_number`,
          [
            reference('RM'),
            buyerId,
            sellerId,
            // Kept for every existing query that still reads it. With more
            // than one line it names the first; order_items is authoritative.
            rows[0]!.listing_id,
            groupId,
            sum((m) => m.subtotalPaise),
            sum((m) => m.shippingPaise),
            sum((m) => m.buyerPremiumPaise),
            sum((m) => m.commissionPaise),
            sum((m) => m.gstOnCommissionPaise),
            sum((m) => m.tdsPaise),
            orderTotal,
          ],
        );
        const orderId = created.rows[0]!.id;

        for (const line of lines) {
          await tx.query(
            `insert into order_items
               (order_id, listing_id, subtotal_paise,
                commission_paise, gst_on_commission_paise, tds_paise, state)
             values ($1, $2, $3, $4, $5, $6, 'payment_pending')`,
            [
              orderId,
              line.row.listing_id,
              line.money.subtotalPaise,
              line.money.commissionPaise,
              line.money.gstOnCommissionPaise,
              line.money.tdsPaise,
            ],
          );
        }

        orders.push({
          id: orderId,
          orderNumber: created.rows[0]!.order_number,
          sellerId,
          totalPaise: orderTotal,
        });
      }

      // Charges, once, across the basket. Delivery is per seller because each
      // posts their own parcel; insurance and gift packing are per basket.
      const charges = computeCharges({
        subtotalPaise: groupTotal,
        sellerCount: bySeller.size,
        wantsInsurance,
        wantsGiftPacking,
      });

      // The coupon is redeemed inside this transaction, under a lock, so two
      // people cannot spend the last one at the same moment. Checked again
      // here rather than trusting what the checkout page was told: the basket
      // may have changed since.
      let discountPaise = 0;
      let couponId: string | null = null;
      if (couponCode !== null) {
        const checked = await checkCoupon(ctx, couponCode, buyerId, groupTotal);
        if (!checked.ok) throw conflict(checked.reason);

        const claimed = await tx.query<{ id: string }>(
          `update coupons
              set used_count = used_count + 1
            where id = $1
              and is_active = true
              and (usage_limit is null or used_count < usage_limit)
            returning id`,
          [checked.coupon.id],
        );
        if (claimed.rows.length === 0) {
          throw conflict('That code was fully claimed a moment ago. Nothing has been charged.');
        }

        discountPaise = checked.discountPaise;
        couponId = checked.coupon.id;
      }

      const payable =
        charges.beforeDiscountPaise - discountPaise;

      await tx.query(
        `update order_groups
            set total_paise = $2, delivery_paise = $3, insurance_paise = $4,
                gift_paise = $5, discount_paise = $6,
                insured_value_paise = $7
          where id = $1`,
        [
          groupId,
          payable,
          charges.deliveryPaise,
          charges.insurancePaise,
          charges.giftPaise,
          discountPaise,
          wantsInsurance ? groupTotal : null,
        ],
      );

      if (couponId !== null) {
        await tx.query(
          `insert into coupon_redemptions (coupon_id, order_group_id, buyer_id, discount_paise)
           values ($1, $2, $3, $4)`,
          [couponId, groupId, buyerId, discountPaise],
        );
      }

      // The basket has become an order; leaving it filled would let the same
      // notes be checked out twice.
      await tx.query(`delete from cart_items where buyer_id = $1`, [buyerId]);

      return json(
        {
          group: {
            id: groupId,
            groupNumber: group.rows[0]!.group_number,
            /** Every line the buyer was shown, so a receipt reconstructs. */
            subtotalInr: groupTotal / 100,
            deliveryInr: charges.deliveryPaise / 100,
            deliveryWaived: charges.deliveryWaived,
            insuranceInr: charges.insurancePaise / 100,
            giftPackingInr: charges.giftPaise / 100,
            discountInr: discountPaise / 100,
            totalInr: payable / 100,
            sellers: orders.length,
            items: cart.rows.length,
          },
          orders: orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            totalInr: o.totalPaise / 100,
          })),
        },
        201,
      );
    });
  });

  /** GET /v1/order-groups/:id — one basket, and every seller's part of it. */
  router.add('GET', '/v1/order-groups/:id', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw conflict('No such order group.');

    const group = await ctx.db.query<{
      id: string;
      group_number: string;
      buyer_id: string;
      total_paise: string;
      delivery_paise: string;
      insurance_paise: string;
      gift_paise: string;
      discount_paise: string;
      placed_at: string | null;
      bill_to_name: string | null;
      bill_to_line1: string | null;
      bill_to_line2: string | null;
      bill_to_city: string | null;
      bill_to_state: string | null;
      bill_to_pin: string | null;
      bill_to_phone: string | null;
    }>(
      `select id, group_number, buyer_id, total_paise::text as total_paise,
              delivery_paise::text  as delivery_paise,
              insurance_paise::text as insurance_paise,
              gift_paise::text      as gift_paise,
              discount_paise::text  as discount_paise,
              placed_at::text as placed_at,
              bill_to_name, bill_to_line1, bill_to_line2, bill_to_city,
              bill_to_state, bill_to_pin, bill_to_phone
         from order_groups where id = $1`,
      [id],
    );
    const g = group.rows[0];
    if (g === undefined || g.buyer_id !== ctx.session.userId) {
      throw conflict('No such order group.');
    }

    const rows = await ctx.db.query<{
      order_id: string;
      order_number: string;
      state: string;
      total_paise: string;
      seller_name: string;
      listing_id: string;
      title: string;
      serial_digits: string | null;
      subtotal_paise: string;
    }>(
      `select o.id as order_id, o.order_number, o.state,
              o.total_paise::text as total_paise, s.display_name as seller_name,
              i.listing_id, l.title, n.serial_digits,
              i.subtotal_paise::text as subtotal_paise
         from orders o
         join sellers s on s.id = o.seller_id
         join order_items i on i.order_id = o.id
         join listings l on l.id = i.listing_id
         left join notes n on n.listing_id = l.id
        where o.group_id = $1
        order by s.display_name, i.created_at`,
      [id],
    );

    const byOrder = new Map<string, Record<string, unknown>>();
    for (const r of rows.rows) {
      let entry = byOrder.get(r.order_id);
      if (entry === undefined) {
        entry = {
          id: r.order_id,
          orderNumber: r.order_number,
          state: r.state,
          seller: r.seller_name,
          totalInr: Number(r.total_paise) / 100,
          items: [] as unknown[],
        };
        byOrder.set(r.order_id, entry);
      }
      (entry['items'] as unknown[]).push({
        listingId: r.listing_id,
        title: r.title,
        serialDigits: r.serial_digits,
        priceInr: Number(r.subtotal_paise) / 100,
      });
    }

    return json({
      group: {
        id: g.id,
        groupNumber: g.group_number,
        /** Every line, so the page can show what the total is made of. */
        deliveryInr: Number(g.delivery_paise) / 100,
        insuranceInr: Number(g.insurance_paise) / 100,
        giftPackingInr: Number(g.gift_paise) / 100,
        discountInr: Number(g.discount_paise) / 100,
        totalInr: Number(g.total_paise) / 100,
        placedAt: g.placed_at,
        /**
         * Who the bill is made out to, as it was on the day. Null only on the
         * groups placed before an address was asked for; the page says so
         * rather than printing an invoice with a blank name on it.
         */
        billTo:
          g.bill_to_name === null
            ? null
            : {
                name: g.bill_to_name,
                line1: g.bill_to_line1,
                line2: g.bill_to_line2,
                city: g.bill_to_city,
                state: g.bill_to_state,
                postalCode: g.bill_to_pin,
                phone: g.bill_to_phone,
              },
      },
      orders: [...byOrder.values()],
    });
  });
}
