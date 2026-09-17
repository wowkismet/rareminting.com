/**
 * Getting the parcel to the buyer.
 *
 * One shipment per order, not per basket: each seller posts their own parcel,
 * so a basket paid for in one charge becomes as many shipments as it has
 * sellers. That is already how delivery is priced, and this keeps the two
 * telling the same story.
 *
 * Who may do what:
 *
 *   - the seller of the order, because they are the one holding the note
 *   - an admin, because somebody has to be able to fix it at four in the
 *     afternoon when the seller cannot
 *   - the buyer may read tracking and nothing else
 *
 * Creating a shipment is deliberately not automatic on payment. A note goes
 * in the post when a human has it in their hand and has packed it; booking a
 * courier the instant money clears would produce pickups for parcels nobody
 * had made yet, and Shiprocket charges for those.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { one, type Database } from '../db.ts';
import { audit } from '../audit.ts';
import {
  assignAwb,
  createShipment,
  orderStateFor,
  requestPickup,
  shiprocketConfig,
  ShiprocketError,
  track,
  type ShipTo,
  type ShipmentItem,
} from '../shiprocket.ts';

const UNAVAILABLE = {
  error: 'shipping_unavailable',
  message: 'The delivery partner is not connected yet. Nothing has been booked.',
} as const;

interface OrderRow {
  id: string;
  order_number: string;
  state: string;
  buyer_id: string;
  seller_user_id: string;
  total_paise: string;
  created_at: string;
  awb: string | null;
  shiprocket_shipment_id: string | null;
  courier_name: string | null;
  shipment_status: string | null;
  ship_to_name: string | null;
  ship_to_line1: string | null;
  ship_to_line2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_pin: string | null;
  ship_to_phone: string | null;
  buyer_email: string | null;
}

/**
 * The order, with everything a shipment needs.
 *
 * The address comes off the group as it was written at checkout rather than
 * from the address book, for the same reason the invoice does: the buyer may
 * have moved house since, and the parcel must go where the bill says.
 */
async function loadOrder(ctx: Ctx, id: string): Promise<OrderRow | null> {
  return one(
    await ctx.db.query<OrderRow>(
      `select o.id, o.order_number, o.state, o.total_paise::text as total_paise,
              o.created_at::text as created_at,
              o.awb, o.shiprocket_shipment_id::text as shiprocket_shipment_id,
              o.courier_name, o.shipment_status,
              g.buyer_id,
              s.user_id as seller_user_id,
              g.bill_to_name as ship_to_name, g.bill_to_line1 as ship_to_line1,
              g.bill_to_line2 as ship_to_line2, g.bill_to_city as ship_to_city,
              g.bill_to_state as ship_to_state, g.bill_to_pin as ship_to_pin,
              g.bill_to_phone as ship_to_phone,
              u.email as buyer_email
         from orders o
         join sellers s on s.id = o.seller_id
         left join order_groups g on g.id = o.group_id
         left join users u on u.id = g.buyer_id
        where o.id = $1`,
      [id],
    ),
  );
}

async function isAdmin(ctx: Ctx, userId: string): Promise<boolean> {
  const rows = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 and role = 'admin'`,
    [userId],
  );
  return rows.rows.length > 0;
}

export function registerShippingRoutes(router: Router, _database: Database): void {
  /**
   * POST /v1/orders/:id/ship — book the parcel with the courier.
   *
   * Three calls to Shiprocket, in order, because each can fail on its own
   * terms and the recovery differs. The order is created; an AWB is assigned,
   * which is where "no courier serves that pin code" and "your account is out
   * of balance" surface; then a pickup is asked for, which is the only one of
   * the three that is safe to fail — the parcel exists and has a number, and
   * a pickup can be re-requested from the dashboard.
   *
   * Safe to call twice. An order that already has an AWB gets it back rather
   * than a second parcel being booked and paid for.
   */
  router.add('POST', '/v1/orders/:id/ship', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const config = shiprocketConfig();
    if (config === null) return json(UNAVAILABLE, 503);

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const order = await loadOrder(ctx, id);
    if (order === null) throw notFound('No such order.');

    const admin = await isAdmin(ctx, session.userId);
    if (order.seller_user_id !== session.userId && !admin) {
      throw notFound('No such order.');
    }

    // Already booked. Hand back what exists rather than booking again: a
    // second parcel is a second charge and a second tracking number the buyer
    // was never given.
    if (order.awb !== null) {
      return json({
        alreadyBooked: true,
        awb: order.awb,
        courierName: order.courier_name,
        status: order.shipment_status,
      });
    }

    // Only a paid order goes in the post. Shipping before the money clears is
    // how a marketplace gives away stock.
    if (order.state !== 'paid' && order.state !== 'packed') {
      throw conflict(
        `This order is ${order.state.replace(/_/g, ' ')}; only a paid order can be shipped.`,
      );
    }

    if (
      order.ship_to_name === null ||
      order.ship_to_line1 === null ||
      order.ship_to_pin === null ||
      order.ship_to_phone === null
    ) {
      throw badRequest(
        'This order has no delivery address recorded, so it cannot be booked. It predates the address requirement — arrange it by hand.',
      );
    }

    const items = await ctx.db.query<{ title: string; listing_id: string; subtotal_paise: string }>(
      `select l.title, i.listing_id, i.subtotal_paise::text as subtotal_paise
         from order_items i join listings l on l.id = i.listing_id
        where i.order_id = $1 and i.state <> 'cancelled'`,
      [id],
    );
    if (items.rows.length === 0) throw conflict('This order has nothing in it to send.');

    const shipTo: ShipTo = {
      name: order.ship_to_name,
      line1: order.ship_to_line1,
      line2: order.ship_to_line2,
      city: order.ship_to_city ?? '',
      state: order.ship_to_state ?? '',
      postalCode: order.ship_to_pin,
      phone: order.ship_to_phone,
      email: order.buyer_email,
    };

    const shipmentItems: ShipmentItem[] = items.rows.map((r) => ({
      name: r.title.slice(0, 100),
      // The listing id is the SKU. Every note here is one of a kind, so there
      // is no product code to use and no two lines can ever share one.
      sku: r.listing_id,
      units: 1,
      sellingPrice: Number(r.subtotal_paise) / 100,
    }));

    try {
      const shipment = await createShipment(config, {
        reference: order.order_number,
        placedAt: new Date(order.created_at),
        shipTo,
        items: shipmentItems,
        subTotalInr: Number(order.total_paise) / 100,
      });

      // Recorded before the AWB is asked for. If assignment fails, the
      // shipment still exists at Shiprocket and this row is what lets it be
      // retried rather than duplicated.
      await ctx.db.query(
        `update orders
            set shiprocket_order_id = $2, shiprocket_shipment_id = $3,
                shipment_status = $4, shipment_updated_at = now()
          where id = $1`,
        [id, shipment.orderId, shipment.shipmentId, shipment.status],
      );

      const awb = await assignAwb(config, shipment.shipmentId);

      await ctx.db.query(
        `update orders
            set awb = $2, courier_name = $3, state = 'shipped',
                shipped_at = coalesce(shipped_at, now()),
                shipment_status = 'AWB assigned', shipment_updated_at = now()
          where id = $1`,
        [id, awb.awb, awb.courierName],
      );

      // The only one of the three allowed to fail quietly: the parcel exists
      // and has a number, and a pickup can be re-requested from the dashboard.
      let pickupRequested = false;
      try {
        pickupRequested = await requestPickup(config, shipment.shipmentId);
      } catch (error) {
        console.error('[shiprocket] pickup request failed for', order.order_number, error);
      }

      await audit(
        ctx,
        session.userId,
        admin ? 'admin' : 'seller',
        'order.shipped',
        'order',
        id,
        { state: order.state },
        { awb: awb.awb, courier: awb.courierName, shipmentId: shipment.shipmentId },
      );

      return json(
        {
          awb: awb.awb,
          courierName: awb.courierName,
          shipmentId: shipment.shipmentId,
          pickupRequested,
        },
        201,
      );
    } catch (error) {
      if (error instanceof ShiprocketError) {
        return json({ error: 'courier_error', message: error.message }, error.status);
      }
      throw error;
    }
  });

  /**
   * GET /v1/orders/:id/tracking — where the parcel is.
   *
   * Readable by the buyer, the seller and staff. The buyer is the whole point:
   * "where is my note" is the single most common support question a
   * marketplace gets, and every answer it can give for itself is one nobody
   * has to write by hand.
   */
  router.add('GET', '/v1/orders/:id/tracking', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const order = await loadOrder(ctx, id);
    if (order === null) throw notFound('No such order.');

    const admin = await isAdmin(ctx, session.userId);
    const mine =
      order.buyer_id === session.userId || order.seller_user_id === session.userId || admin;
    if (!mine) throw notFound('No such order.');

    if (order.awb === null) {
      return json({ booked: false, status: order.state, events: [] });
    }

    const config = shiprocketConfig();
    if (config === null) {
      // The number is still useful even with the integration off — it can be
      // pasted into the courier's own site.
      return json({
        booked: true,
        awb: order.awb,
        courierName: order.courier_name,
        status: order.shipment_status,
        events: [],
        live: false,
      });
    }

    try {
      const tracking = await track(config, order.awb);
      if (tracking === null) {
        return json({
          booked: true,
          awb: order.awb,
          courierName: order.courier_name,
          status: order.shipment_status,
          events: [],
          live: false,
        });
      }

      await applyTracking(ctx, id, tracking.status, tracking.deliveredAt);

      return json({
        booked: true,
        awb: tracking.awb,
        courierName: tracking.courierName ?? order.courier_name,
        status: tracking.status,
        deliveredAt: tracking.deliveredAt,
        events: tracking.events,
        live: true,
      });
    } catch {
      // A courier that cannot be reached is not a reason to fail the page the
      // buyer is looking at. Give them what is on file.
      return json({
        booked: true,
        awb: order.awb,
        courierName: order.courier_name,
        status: order.shipment_status,
        events: [],
        live: false,
      });
    }
  });

  /**
   * POST /v1/webhooks/shiprocket — the courier telling us where a parcel is.
   *
   * Authenticated by a shared token Shiprocket sends in `x-api-key`, which is
   * all it offers — there is no signature over the body. So this is trusted
   * only as far as it can be: it may move a shipment's status and mark an
   * order delivered, and it may do nothing else. It cannot move money, cannot
   * touch a listing, and an unknown AWB is ignored rather than created.
   */
  router.add('POST', '/v1/webhooks/shiprocket', async (ctx) => {
    const expected = process.env['SHIPROCKET_WEBHOOK_TOKEN'];
    if (expected === undefined || expected === '') {
      return json({ error: 'not_configured' }, 503);
    }
    const supplied = ctx.req.headers.get('x-api-key');
    if (supplied === null || supplied !== expected) {
      return json({ error: 'bad_token' }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(await ctx.rawBody());
    } catch {
      return json({ error: 'bad_body' }, 400);
    }

    const payload = (body ?? {}) as Record<string, unknown>;
    const awb =
      typeof payload['awb'] === 'string'
        ? payload['awb']
        : typeof payload['awb'] === 'number'
          ? String(payload['awb'])
          : null;
    const status =
      typeof payload['current_status'] === 'string'
        ? payload['current_status']
        : typeof payload['shipment_status'] === 'string'
          ? payload['shipment_status']
          : null;

    if (awb === null || status === null) {
      // Acknowledge regardless. A 4xx makes Shiprocket retry an event we will
      // never be able to act on.
      return json({ received: true, acted: false });
    }

    const found = one(
      await ctx.db.query<{ id: string }>(`select id from orders where awb = $1`, [awb]),
    );
    if (found === null) return json({ received: true, acted: false });

    const deliveredAt =
      typeof payload['delivered_date'] === 'string' ? payload['delivered_date'] : null;
    const acted = await applyTracking(ctx, found.id, status, deliveredAt);
    return json({ received: true, acted });
  });
}

/**
 * Record what the courier says, and move the order if it means something.
 *
 * Idempotent: the guards mean re-applying the same status matches no rows.
 * Only two courier statuses move an order — shipped and delivered — and the
 * rest are kept against the shipment. An order does not need a state for
 * "reached destination hub", and giving it one would let every courier's
 * vocabulary leak into this system's.
 *
 * Delivery deliberately does not complete an order. The inspection window
 * starts when the parcel lands; the seller is paid at the end of it, not on
 * arrival.
 */
async function applyTracking(
  ctx: Ctx,
  orderId: string,
  status: string,
  deliveredAt: string | null,
): Promise<boolean> {
  const mapped = orderStateFor(status);

  const updated = await ctx.db.query<{ id: string }>(
    `update orders
        set shipment_status = $2,
            shipment_updated_at = now(),
            shipped_at = case when $3 = 'shipped' and shipped_at is null
                              then now() else shipped_at end,
            delivered_at = case when $3 = 'delivered' and delivered_at is null
                                then coalesce($4::timestamptz, now()) else delivered_at end,
            state = case
                      when $3 = 'delivered' and state in ('paid','packed','shipped')
                        then 'delivered'
                      when $3 = 'shipped' and state in ('paid','packed')
                        then 'shipped'
                      else state
                    end
      where id = $1
        and (shipment_status is distinct from $2 or delivered_at is null)
      returning id`,
    [orderId, status, mapped, deliveredAt],
  );

  return updated.rows.length > 0;
}
