/**
 * Taking money.
 *
 * The flow is: the buyer places an order, asks us to start a payment, pays at
 * Razorpay, and Razorpay tells us — twice. Once through the browser, once
 * through a webhook. Only the webhook is believed.
 *
 * That distinction is the whole design. The browser callback is signed, but the
 * buyer controls the browser, and a signature check there only proves the
 * message was not tampered with in transit — not that money moved. The webhook
 * arrives from Razorpay's servers, signed with a separate secret, and is what
 * marks an order paid. The browser callback exists so the buyer sees an answer
 * without waiting, and it says "we are confirming" rather than "paid".
 *
 * Webhooks retry until they get a 2xx, and they can arrive out of order or
 * twice. Everything here is therefore idempotent: applying the same event a
 * second time must change nothing.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';
import {
  createGatewayOrder,
  checkoutSignatureValid,
  fetchOrderPayments,
  paymentFromWebhook,
  razorpayConfig,
  RazorpayError,
  webhookSignatureValid,
} from '../razorpay.ts';

/** States from which a payment may still be started. */
const PAYABLE = ['created', 'payment_pending'] as const;

interface OrderRow {
  id: string;
  order_number: string;
  buyer_id: string;
  state: string;
  total_paise: string;
}

export function registerPaymentRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/orders/:id/payment
   *
   * Start, or resume, paying for an order. Returns what the browser needs to
   * open Razorpay's checkout. Safe to call twice: an order that already has a
   * gateway order gets the same one back rather than a second one, so a buyer
   * who reloads does not end up with two payments outstanding.
   */
  router.add('POST', '/v1/orders/:id/payment', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const config = razorpayConfig();
    if (config === null) {
      return json(
        {
          error: 'payments_unavailable',
          message: 'Payments are not switched on yet. Your order is saved and nothing was charged.',
        },
        503,
      );
    }

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const found = await ctx.db.query<OrderRow>(
      `select id, order_number, buyer_id, state, total_paise::text as total_paise
         from orders where id = $1`,
      [id],
    );
    const order = one(found);
    // 404 rather than 403: whether somebody else's order exists is not the
    // caller's business.
    if (order === null || order.buyer_id !== session.userId) throw notFound('No such order.');

    if (!(PAYABLE as readonly string[]).includes(order.state)) {
      throw conflict(`This order is ${order.state.replace(/_/g, ' ')} and cannot be paid for.`);
    }

    // Reuse an outstanding attempt rather than creating a second.
    const existing = one(
      await ctx.db.query<{ gateway_order_id: string | null; amount_paise: string }>(
        `select gateway_order_id, amount_paise::text as amount_paise
           from payments
          where order_id = $1 and state in ('created', 'authorized')
            and gateway_order_id is not null
          order by created_at desc
          limit 1`,
        [id],
      ),
    );

    const amountPaise = Number(order.total_paise);
    if (existing !== null && existing.gateway_order_id !== null) {
      return json({
        keyId: config.keyId,
        gatewayOrderId: existing.gateway_order_id,
        amountPaise: Number(existing.amount_paise),
        currency: 'INR',
        orderNumber: order.order_number,
        isTest: config.isTest,
      });
    }

    let gatewayOrder;
    try {
      gatewayOrder = await createGatewayOrder(config, {
        amountPaise,
        receipt: order.order_number,
        notes: { order_id: order.id, order_number: order.order_number },
      });
    } catch (error) {
      if (error instanceof RazorpayError) {
        return json({ error: 'gateway_error', message: error.message }, error.status);
      }
      throw error;
    }

    await ctx.db.query(
      `insert into payments (order_id, gateway, gateway_order_id, amount_paise, state)
       values ($1, 'razorpay', $2, $3, 'created')`,
      [order.id, gatewayOrder.id, amountPaise],
    );

    return json({
      keyId: config.keyId,
      gatewayOrderId: gatewayOrder.id,
      amountPaise,
      currency: gatewayOrder.currency,
      orderNumber: order.order_number,
      isTest: config.isTest,
    });
  });

  /**
   * POST /v1/payments/checkout-callback
   *
   * What the browser reports after checkout closes. The signature proves the
   * message was not altered on its way through the browser; it does not prove
   * money moved, so this never marks an order paid. It records the payment id
   * and tells the buyer we are confirming.
   */
  router.add('POST', '/v1/payments/checkout-callback', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const config = razorpayConfig();
    if (config === null) throw forbidden('Payments are not switched on.');

    const fields = asObject(await ctx.body());
    const gatewayOrderId = requiredString(fields, 'gatewayOrderId', 64);
    const gatewayPaymentId = requiredString(fields, 'gatewayPaymentId', 64);
    const signature = requiredString(fields, 'signature', 256);

    if (!checkoutSignatureValid(config, gatewayOrderId, gatewayPaymentId, signature)) {
      throw badRequest('That payment could not be verified.', { signature: 'invalid' });
    }

    // The signature is valid, but it is still the buyer's browser talking. Only
    // attach the payment id to a payment row we already created ourselves, and
    // only if this buyer owns the order.
    const row = one(
      await ctx.db.query<{ id: string; order_id: string; buyer_id: string; state: string }>(
        `select p.id, p.order_id, o.buyer_id, o.state
           from payments p
           join orders o on o.id = p.order_id
          where p.gateway_order_id = $1`,
        [gatewayOrderId],
      ),
    );
    if (row === null || row.buyer_id !== session.userId) throw notFound('No such payment.');

    await ctx.db.query(
      `update payments set gateway_payment_id = coalesce(gateway_payment_id, $2)
        where id = $1`,
      [row.id, gatewayPaymentId],
    );

    return json({
      received: true,
      // Deliberately not "paid". The webhook decides that.
      state: row.state,
      message:
        'Payment received. We are confirming it with the payment provider — your order updates within a moment.',
    });
  });

  /**
   * POST /v1/webhooks/razorpay
   *
   * The authority. Unauthenticated by design — it is not a person, it is
   * Razorpay's servers — so the signature over the raw body is the only thing
   * standing between this and anyone marking any order paid.
   */
  router.add('POST', '/v1/webhooks/razorpay', async (ctx) => {
    const config = razorpayConfig();
    if (config === null || config.webhookSecret === null) {
      // Nothing configured to verify against. Refusing is the only safe answer:
      // accepting unverified events would let anyone mark orders paid.
      return json({ error: 'not_configured' }, 503);
    }

    const raw = await ctx.rawBody();
    const signature = ctx.req.headers.get('x-razorpay-signature');
    if (signature === null || !webhookSignatureValid(config, raw, signature)) {
      return json({ error: 'bad_signature' }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'bad_body' }, 400);
    }

    const event = (body as { event?: unknown }).event;
    const payment = paymentFromWebhook(body);

    if (typeof event !== 'string' || payment === null || payment.orderId === null) {
      // Acknowledge anyway. A 4xx makes Razorpay retry an event we will never
      // be able to act on, forever.
      return json({ received: true, acted: false });
    }

    const acted = await applyPaymentEvent(ctx, database, event, payment, raw);
    return json({ received: true, acted });
  });
}

/**
 * Apply one payment event, idempotently and in a single transaction.
 *
 * Returns whether anything changed. Applying the same event twice is a no-op:
 * the state guards in each UPDATE mean a replay matches no rows.
 */
async function applyPaymentEvent(
  ctx: Ctx,
  database: Database,
  event: string,
  payment: { id: string; orderId: string | null; amountPaise: number; method: string | null; status: string; errorDescription: string | null },
  raw: string,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    // Lock the payment row so two concurrent deliveries of the same event
    // cannot both pass the state check.
    const found = one(
      await tx.query<{ id: string; order_id: string; state: string; amount_paise: string }>(
        `select id, order_id, state, amount_paise::text as amount_paise
           from payments
          where gateway_order_id = $1
          for update`,
        [payment.orderId],
      ),
    );

    // A payment we never created. Record nothing and change nothing — this is
    // either a different integration on the same account, or someone probing.
    if (found === null) return false;

    // The amount must be exactly what we asked for. A mismatch means the order
    // was tampered with somewhere, and is never treated as payment.
    if (Number(found.amount_paise) !== payment.amountPaise) {
      console.error(
        `[razorpay] amount mismatch on ${payment.id}: expected ${found.amount_paise}, got ${payment.amountPaise}`,
      );
      await tx.query(
        `update payments
            set state = 'failed', failure_reason = 'amount mismatch', raw = $2::jsonb
          where id = $1`,
        [found.id, raw],
      );
      return true;
    }

    if (event === 'payment.failed') {
      const updated = await tx.query<{ id: string }>(
        `update payments
            set state = 'failed',
                gateway_payment_id = coalesce(gateway_payment_id, $2),
                method = coalesce(method, $3),
                failure_reason = $4,
                raw = $5::jsonb
          where id = $1 and state <> 'captured'
          returning id`,
        [found.id, payment.id, payment.method, payment.errorDescription, raw],
      );
      return updated.rows.length > 0;
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      const updated = await tx.query<{ id: string }>(
        `update payments
            set state = 'captured',
                gateway_payment_id = coalesce(gateway_payment_id, $2),
                method = coalesce(method, $3),
                captured_at = coalesce(captured_at, now()),
                raw = $4::jsonb
          where id = $1 and state <> 'captured'
          returning id`,
        [found.id, payment.id, payment.method, raw],
      );
      // Already captured — a retry or the second of payment.captured and
      // order.paid, which both fire for one payment. Nothing more to do.
      if (updated.rows.length === 0) return false;

      // Move the order on, but only from a state that is waiting for money.
      await tx.query(
        `update orders
            set state = 'paid'
          where id = $1 and state in ('created', 'payment_pending')`,
        [found.order_id],
      );

      await tx.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
         values (null, 'payment.captured', 'order', $1::text, $2::inet, $3)`,
        [found.order_id, ctx.ip, 'razorpay-webhook'],
      );
      return true;
    }

    if (event === 'refund.processed') {
      const updated = await tx.query<{ id: string }>(
        `update payments set state = 'refunded', raw = $2::jsonb
          where id = $1 and state <> 'refunded'
          returning id`,
        [found.id, raw],
      );
      if (updated.rows.length === 0) return false;
      await tx.query(
        `update orders set state = 'refunded'
          where id = $1 and state not in ('refunded', 'cancelled')`,
        [found.order_id],
      );
      return true;
    }

    return false;
  });
}

/**
 * Ask Razorpay what really happened to an order, and apply it.
 *
 * Webhooks are best-effort. A delivery can be lost, the receiver can be down
 * for a minute, a secret can be mismatched after somebody rotates it — and
 * when that happens the money has still moved. An integration that only
 * listens will eventually take a buyer's payment and leave their order sitting
 * unpaid, which is the worst failure this system has: the buyer is out of
 * pocket and the site says they owe money.
 *
 * So the gateway is polled as well as listened to. It goes through the same
 * applyPaymentEvent as a webhook, which means the same amount check, the same
 * idempotency, the same audit line — a reconciled payment is indistinguishable
 * from a delivered one, and running this twice changes nothing.
 *
 * Returns whether anything changed.
 */
export async function reconcileOrder(
  ctx: Ctx,
  database: Database,
  orderId: string,
): Promise<boolean> {
  const config = razorpayConfig();
  if (config === null) return false;

  const rows = await ctx.db.query<{ gateway_order_id: string }>(
    `select p.gateway_order_id
       from payments p
       join orders o on o.id = p.order_id
      where p.order_id = $1
        and p.gateway_order_id is not null
        and p.state in ('created', 'authorized')
        and o.state in ('created', 'payment_pending')`,
    [orderId],
  );

  let changed = false;
  for (const row of rows.rows) {
    let payments;
    try {
      payments = await fetchOrderPayments(config, row.gateway_order_id);
    } catch (error) {
      // A gateway that cannot be reached is not a reason to fail the page the
      // buyer is looking at. Log it and leave the order as it stands.
      console.error('[razorpay] reconcile failed for', row.gateway_order_id, error);
      continue;
    }

    for (const payment of payments) {
      // Only a captured payment moves an order. An authorised-but-uncaptured
      // one is money held, not money taken.
      if (payment.status !== 'captured') continue;
      if (await applyPaymentEvent(ctx, database, 'payment.captured', payment, JSON.stringify(payment))) {
        console.log(`[razorpay] reconciled ${payment.id} for order ${orderId}`);
        changed = true;
      }
    }
  }

  return changed;
}
