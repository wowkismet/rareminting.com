/**
 * Buying: offers and orders.
 *
 * The money in an order is worked out once, at the moment it is placed, and
 * stored on the row. Rates change; an order must always be explainable by the
 * rates that applied when it was made, not by whatever is current.
 *
 * Reserving the listing and creating the order happen in one transaction, and
 * the reservation is conditional on the listing still being `minted`. Two
 * buyers clicking at the same instant therefore cannot both win it — the second
 * update matches no row and the whole order rolls back.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString } from '../validate.ts';
import { one, type Database } from '../db.ts';
import { computeBreakdown, DEFAULT_RATES, type Rates } from '../money.ts';

const OFFER_RESPONSES = ['accepted', 'declined'] as const;

/** Rates in force for this seller, most specific rule first. */
async function ratesFor(ctx: Ctx, sellerKind: string): Promise<Rates> {
  const result = await ctx.db.query<{
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
    [sellerKind],
  );

  const row = one(result);
  if (row === null) return DEFAULT_RATES;

  return {
    takeRateBps: row.take_rate_bps,
    listingFeePaise: Number(row.listing_fee_paise),
    buyerPremiumBps: row.buyer_premium_bps,
    gstRateBps: row.gst_rate_bps,
    tdsRateBps: row.tds_rate_bps,
  };
}

/** Human-facing reference. Short enough to read down a phone line. */
function orderNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const noise = Math.floor(Math.random() * 46_656)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  return `RM-${stamp}-${noise}`;
}

interface SaleableListing {
  id: string;
  seller_id: string;
  seller_kind: string;
  seller_user_id: string;
  price_paise: string | null;
  state: string;
  title: string;
}

async function saleable(ctx: Ctx, listingId: string): Promise<SaleableListing | null> {
  const result = await ctx.db.query<SaleableListing>(
    `select l.id, l.seller_id, s.kind as seller_kind, s.user_id as seller_user_id,
            l.price_paise::text as price_paise, l.state, l.title
       from listings l
       join sellers s on s.id = l.seller_id
      where l.id = $1`,
    [listingId],
  );
  return one(result);
}

export function registerOrderRoutes(router: Router, database: Database): void {
  /** POST /v1/listings/:id/order — buy at the asking price. */
  router.add('POST', '/v1/listings/:id/order', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['id'] ?? '';

    const listing = await saleable(ctx, listingId);
    if (listing === null) throw notFound('No such listing.');
    if (listing.seller_user_id === ctx.session.userId) {
      throw badRequest('You cannot buy your own listing.');
    }
    if (listing.state !== 'minted') {
      throw conflict(
        listing.state === 'struck' || listing.state === 'reserved'
          ? 'This note has already been sold.'
          : 'This listing is not currently for sale.',
      );
    }
    if (listing.price_paise === null) throw conflict('This listing has no price.');

    const rates = await ratesFor(ctx, listing.seller_kind);
    const breakdown = computeBreakdown({
      subtotalPaise: Number(listing.price_paise),
      rates,
    });

    const buyerId = ctx.session.userId;

    const order = await database.transaction(async (tx) => {
      // Conditional on the listing still being minted. If another buyer got
      // there first this matches nothing, and the throw rolls the order back.
      const reserved = await tx.query<{ id: string }>(
        `update listings set state = 'reserved'
          where id = $1 and state = 'minted'
          returning id`,
        [listingId],
      );
      if (reserved.rows.length === 0) {
        throw conflict('Someone else bought this note a moment ago.');
      }

      const created = await tx.query<{ id: string; order_number: string; state: string }>(
        `insert into orders
           (order_number, buyer_id, seller_id, listing_id, state,
            subtotal_paise, shipping_paise, buyer_premium_paise,
            commission_paise, gst_on_commission_paise, tds_paise, total_paise,
            placed_at)
         values ($1, $2, $3, $4, 'payment_pending',
                 $5, $6, $7, $8, $9, $10, $11, now())
         returning id, order_number, state`,
        [
          orderNumber(),
          buyerId,
          listing.seller_id,
          listingId,
          breakdown.subtotalPaise,
          breakdown.shippingPaise,
          breakdown.buyerPremiumPaise,
          breakdown.commissionPaise,
          breakdown.gstOnCommissionPaise,
          breakdown.tdsPaise,
          breakdown.totalPaise,
        ],
      );

      const row = created.rows[0];
      if (row === undefined) throw new Error('failed to create order');

      await tx.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, after)
         values ($1::uuid, 'order.create', 'order', $2::text, $3::jsonb)`,
        [buyerId, row.id, JSON.stringify({ listingId, total: breakdown.totalPaise })],
      );

      return row;
    });

    return json(
      {
        order: {
          id: order.id,
          orderNumber: order.order_number,
          state: order.state,
          listingTitle: listing.title,
          subtotalInr: breakdown.subtotalPaise / 100,
          shippingInr: breakdown.shippingPaise / 100,
          totalInr: breakdown.totalPaise / 100,
        },
        // Shown to the buyer so the total is never a mystery.
        breakdown: {
          subtotalInr: breakdown.subtotalPaise / 100,
          shippingInr: breakdown.shippingPaise / 100,
          buyerPremiumInr: breakdown.buyerPremiumPaise / 100,
          totalInr: breakdown.totalPaise / 100,
        },
      },
      201,
    );
  });

  /** GET /v1/orders — everything the signed-in user is party to. */
  router.add('GET', '/v1/orders', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const rows = await ctx.db.query<{
      id: string;
      order_number: string;
      state: string;
      total_paise: string;
      created_at: string;
      title: string;
      serial_digits: string | null;
      role: string;
    }>(
      `select o.id, o.order_number, o.state, o.total_paise::text as total_paise,
              o.created_at::text as created_at, l.title, n.serial_digits,
              case when o.buyer_id = $1 then 'buyer' else 'seller' end as role
         from orders o
         join listings l on l.id = o.listing_id
         left join notes n on n.listing_id = l.id
         left join sellers s on s.id = o.seller_id
        where o.buyer_id = $1 or s.user_id = $1
        order by o.created_at desc
        limit 100`,
      [ctx.session.userId],
    );

    return json({
      orders: rows.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        state: r.state,
        totalInr: Number(r.total_paise) / 100,
        title: r.title,
        serialDigits: r.serial_digits,
        role: r.role,
        createdAt: r.created_at,
      })),
    });
  });

  /** GET /v1/orders/:id — one order, to whoever is party to it. */
  router.add('GET', '/v1/orders/:id', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const result = await ctx.db.query<Record<string, string>>(
      `select o.id, o.order_number, o.state,
              o.subtotal_paise::text, o.shipping_paise::text, o.buyer_premium_paise::text,
              o.commission_paise::text, o.gst_on_commission_paise::text, o.tds_paise::text,
              o.total_paise::text, o.created_at::text as created_at,
              o.inspection_ends_at::text as inspection_ends_at,
              l.title, n.serial_digits,
              case when o.buyer_id = $2 then 'buyer' else 'seller' end as role
         from orders o
         join listings l on l.id = o.listing_id
         left join notes n on n.listing_id = l.id
         left join sellers s on s.id = o.seller_id
        where o.id = $1 and (o.buyer_id = $2 or s.user_id = $2)`,
      [id, ctx.session.userId],
    );

    const row = one(result);
    // Not "forbidden": an order someone is not party to should not be
    // confirmed to exist at all.
    if (row === null) throw notFound('No such order.');

    const paise = (k: string): number => Number(row[k] ?? 0);
    const isSeller = row['role'] === 'seller';

    return json({
      order: {
        id: row['id'],
        orderNumber: row['order_number'],
        state: row['state'],
        title: row['title'],
        serialDigits: row['serial_digits'],
        role: row['role'],
        createdAt: row['created_at'],
        inspectionEndsAt: row['inspection_ends_at'],
        subtotalInr: paise('subtotal_paise') / 100,
        shippingInr: paise('shipping_paise') / 100,
        buyerPremiumInr: paise('buyer_premium_paise') / 100,
        totalInr: paise('total_paise') / 100,
        // The seller's deductions are shown only to the seller; a buyer has no
        // business seeing what the platform takes from the other side.
        ...(isSeller
          ? {
              commissionInr: paise('commission_paise') / 100,
              gstOnCommissionInr: paise('gst_on_commission_paise') / 100,
              tdsInr: paise('tds_paise') / 100,
              payoutInr:
                (paise('subtotal_paise') -
                  paise('commission_paise') -
                  paise('gst_on_commission_paise') -
                  paise('tds_paise')) /
                100,
            }
          : {}),
      },
    });
  });

  /** POST /v1/listings/:id/offers — offer less than the asking price. */
  router.add('POST', '/v1/listings/:id/offers', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['id'] ?? '';

    const fields = asObject(await ctx.body());
    const amountInr = fields['amountInr'];
    if (typeof amountInr !== 'number' || !Number.isFinite(amountInr) || amountInr <= 0) {
      throw badRequest('Enter how much you would like to offer, in rupees.', {
        amountInr: 'invalid',
      });
    }
    const message = optionalString(fields, 'message', 500);
    const amountPaise = Math.round(amountInr * 100);

    const listing = await saleable(ctx, listingId);
    if (listing === null) throw notFound('No such listing.');
    if (listing.seller_user_id === ctx.session.userId) {
      throw badRequest('You cannot make an offer on your own listing.');
    }
    if (listing.state !== 'minted') throw conflict('This listing is not currently for sale.');
    if (listing.price_paise !== null && amountPaise >= Number(listing.price_paise)) {
      throw badRequest('That is the asking price or more — buy it directly instead.');
    }

    const created = await ctx.db.query<{ id: string; expires_at: string }>(
      `insert into offers (listing_id, buyer_id, amount_paise, message, expires_at)
       values ($1, $2, $3, $4, now() + interval '7 days')
       returning id, expires_at::text as expires_at`,
      [listingId, ctx.session.userId, amountPaise, message],
    );

    const row = created.rows[0];
    if (row === undefined) throw new Error('failed to create offer');

    return json({ offer: { id: row.id, amountInr, expiresAt: row.expires_at, state: 'open' } }, 201);
  });

  /** GET /v1/offers — offers made by, or received by, the signed-in user. */
  router.add('GET', '/v1/offers', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const rows = await ctx.db.query<{
      id: string;
      amount_paise: string;
      state: string;
      message: string | null;
      created_at: string;
      title: string;
      listing_id: string;
      role: string;
    }>(
      `select o.id, o.amount_paise::text as amount_paise, o.state, o.message,
              o.created_at::text as created_at, l.title, l.id as listing_id,
              case when o.buyer_id = $1 then 'buyer' else 'seller' end as role
         from offers o
         join listings l on l.id = o.listing_id
         join sellers s on s.id = l.seller_id
        where o.buyer_id = $1 or s.user_id = $1
        order by o.created_at desc
        limit 100`,
      [ctx.session.userId],
    );

    return json({
      offers: rows.rows.map((r) => ({
        id: r.id,
        listingId: r.listing_id,
        title: r.title,
        amountInr: Number(r.amount_paise) / 100,
        state: r.state,
        message: r.message,
        role: r.role,
        createdAt: r.created_at,
      })),
    });
  });

  /** POST /v1/offers/:id/respond — the seller accepts or declines. */
  router.add('POST', '/v1/offers/:id/respond', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const decision = oneOf(fields, 'decision', OFFER_RESPONSES);

    const found = await ctx.db.query<{
      id: string;
      state: string;
      seller_user_id: string;
    }>(
      `select o.id, o.state, s.user_id as seller_user_id
         from offers o
         join listings l on l.id = o.listing_id
         join sellers s on s.id = l.seller_id
        where o.id = $1`,
      [id],
    );

    const offer = one(found);
    if (offer === null) throw notFound('No such offer.');
    if (offer.seller_user_id !== ctx.session.userId) {
      throw forbidden('Only the seller can respond to this offer.');
    }
    if (offer.state !== 'open') {
      throw conflict(`This offer has already been ${offer.state}.`);
    }

    await ctx.db.query(
      `update offers set state = $2::offer_state, responded_at = now() where id = $1`,
      [id, decision],
    );

    return json({ id, state: decision });
  });
}
