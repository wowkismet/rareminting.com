/**
 * Taking money.
 *
 * The flow is: the buyer places an order, asks us to start a payment, pays at
 * Cashfree, and comes back to us by redirect. Cashfree tells us separately,
 * through a webhook, and only the webhook marks an order paid.
 *
 * That distinction is the whole design. The buyer controls their own browser,
 * so nothing it says about a payment can be the record — and under Cashfree it
 * is not even asked: the redirect back carries an order id and nothing else.
 * What the buyer is shown immediately comes from a server-to-server lookup;
 * what the order's state is set to comes from the webhook, or from the same
 * lookup reconciling a webhook that never arrived.
 *
 * Webhooks retry until they get a 2xx, and they can arrive out of order or
 * twice. Everything here is therefore idempotent: applying the same event a
 * second time must change nothing.
 */

import { randomUUID } from 'node:crypto';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { conflict, notFound, unauthorized } from '../errors.ts';
import { one, type Database } from '../db.ts';
import {
  cashfreeConfig,
  createGatewayOrder,
  fetchOrder,
  fetchOrderPayments,
  eventFromWebhook,
  CashfreeError,
  webhookSignatureValid,
  type CashfreeConfig,
  type GatewayPayment,
} from '../cashfree.ts';

/** States from which a payment may still be started. */
const PAYABLE = ['created', 'payment_pending'] as const;

/** Recorded on every payment row this file creates. */
const GATEWAY = 'cashfree';

/**
 * Where the buyer is sent back to, and where Cashfree posts its webhook.
 *
 * Both have to be absolute and reachable from the public internet, so they
 * cannot be derived from the request — an API called over localhost by the web
 * server would produce a return URL pointing at the API's own port.
 */
function siteUrl(): string {
  return (process.env['SITE_URL'] ?? 'https://rareminting.com').replace(/\/+$/, '');
}

function apiUrl(): string {
  return (process.env['PUBLIC_API_URL'] ?? `${siteUrl()}/api`).replace(/\/+$/, '');
}

interface OrderRow {
  id: string;
  order_number: string;
  buyer_id: string;
  state: string;
  total_paise: string;
}

/**
 * The id we give Cashfree.
 *
 * Our own reference plus a per-attempt suffix. Cashfree requires an order id
 * to be unique on the merchant account for all time and refuses a repeat, so
 * a buyer whose first attempt expired could never try again if we sent the
 * bare order number.
 */
function gatewayOrderId(reference: string): string {
  return `${reference}-${randomUUID().slice(0, 8)}`;
}

/** Everything the browser needs to open Cashfree's checkout. */
function startedPayment(
  config: CashfreeConfig,
  {
    gatewayOrderId: id,
    paymentSessionId,
    amountPaise,
    currency,
    reference,
  }: {
    gatewayOrderId: string;
    paymentSessionId: string;
    amountPaise: number;
    currency: string;
    reference: string;
  },
): Response {
  return json({
    provider: GATEWAY,
    gatewayOrderId: id,
    paymentSessionId,
    amountPaise,
    currency,
    orderNumber: reference,
    // The SDK needs to be told which of Cashfree's two environments to open,
    // and it must agree with the environment the order was created in.
    mode: config.isTest ? 'sandbox' : 'production',
    isTest: config.isTest,
  });
}

const UNAVAILABLE = {
  error: 'payments_unavailable',
  message: 'Payments are not switched on yet. Your order is saved and nothing was charged.',
} as const;

/** The buyer's details, as Cashfree requires them on every order. */
interface Customer {
  customerId: string;
  customerPhone: string;
  customerName: string | null;
  customerEmail: string | null;
}

async function customerFor(ctx: Ctx, userId: string): Promise<Customer> {
  const user = one(
    await ctx.db.query<{ email: string; full_name: string | null; phone_e164: string | null }>(
      `select email, full_name, phone_e164 from users where id = $1`,
      [userId],
    ),
  );

  // Cashfree requires a ten-digit phone. Most buyers have verified one; for
  // those who have not, a placeholder is better than refusing to let them pay
  // — the number is only used to offer UPI intents, never to reach them.
  const digits = (user?.phone_e164 ?? '').replace(/\D/g, '').slice(-10);
  return {
    customerId: userId.replace(/-/g, '').slice(0, 50),
    customerPhone: digits.length === 10 ? digits : '9999999999',
    customerName: user?.full_name ?? null,
    customerEmail: user?.email ?? null,
  };
}

export function registerPaymentRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/orders/:id/payment
   *
   * Start, or resume, paying for one order. Safe to call twice: an order that
   * already has a live attempt at the gateway gets that one back rather than a
   * second, so a buyer who reloads cannot end up with two payments
   * outstanding and be charged twice.
   */
  router.add('POST', '/v1/orders/:id/payment', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const config = cashfreeConfig();
    if (config === null) return json(UNAVAILABLE, 503);

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const order = one(
      await ctx.db.query<OrderRow>(
        `select id, order_number, buyer_id, state, total_paise::text as total_paise
           from orders where id = $1`,
        [id],
      ),
    );
    // 404 rather than 403: whether somebody else's order exists is not the
    // caller's business.
    if (order === null || order.buyer_id !== session.userId) throw notFound('No such order.');

    if (!(PAYABLE as readonly string[]).includes(order.state)) {
      throw conflict(`This order is ${order.state.replace(/_/g, ' ')} and cannot be paid for.`);
    }

    return startOrResume(ctx, config, {
      column: 'order_id',
      ownerId: order.id,
      reference: order.order_number,
      amountPaise: Number(order.total_paise),
      buyerId: session.userId,
      returnPath: `/orders/${order.id}`,
    });
  });

  /**
   * POST /v1/order-groups/:id/payment — one charge for a whole basket.
   *
   * The same shape as paying for a single order, against the group total. The
   * payment row carries the group rather than an order, and when it captures
   * every seller's part of the basket clears together — one card charge cannot
   * sensibly leave half a basket unpaid.
   */
  router.add('POST', '/v1/order-groups/:id/payment', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const config = cashfreeConfig();
    if (config === null) return json(UNAVAILABLE, 503);

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order group.');

    const group = one(
      await ctx.db.query<{
        id: string;
        group_number: string;
        buyer_id: string;
        total_paise: string;
      }>(
        `select id, group_number, buyer_id, total_paise::text as total_paise
           from order_groups where id = $1`,
        [id],
      ),
    );
    if (group === null || group.buyer_id !== session.userId) {
      throw notFound('No such order group.');
    }

    // Every order in the group must still be waiting for money. If any has
    // moved on, this basket has already been paid for and charging again would
    // take the money twice.
    const states = await ctx.db.query<{ waiting: string; total: string }>(
      `select count(*) filter (where state in ('created','payment_pending'))::text as waiting,
              count(*)::text as total
         from orders where group_id = $1`,
      [id],
    );
    const row = states.rows[0];
    if (row === undefined || row.total === '0') throw notFound('No such order group.');
    if (row.waiting !== row.total) throw conflict('This basket has already been paid for.');

    return startOrResume(ctx, config, {
      column: 'group_id',
      ownerId: group.id,
      reference: group.group_number,
      amountPaise: Number(group.total_paise),
      buyerId: session.userId,
      returnPath: `/pay/group/${group.id}`,
    });
  });

  /**
   * POST /v1/webhooks/cashfree
   *
   * The authority. Unauthenticated by design — it is not a person, it is
   * Cashfree's servers — so the signature over the raw body is the only thing
   * standing between this and anyone marking any order paid.
   */
  router.add('POST', '/v1/webhooks/cashfree', async (ctx) => {
    const config = cashfreeConfig();
    if (config === null) {
      // Nothing configured to verify against. Refusing is the only safe
      // answer: accepting unverified events would let anyone mark orders paid.
      return json({ error: 'not_configured' }, 503);
    }

    const raw = await ctx.rawBody();
    const signature = ctx.req.headers.get('x-webhook-signature');
    const timestamp = ctx.req.headers.get('x-webhook-timestamp');
    if (
      signature === null ||
      timestamp === null ||
      !webhookSignatureValid(config, timestamp, raw, signature)
    ) {
      return json({ error: 'bad_signature' }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'bad_body' }, 400);
    }

    const parsed = eventFromWebhook(body);
    if (parsed === null || parsed.payment.orderId === null) {
      // Acknowledge anyway. A 4xx makes Cashfree retry an event we will never
      // be able to act on, forever.
      return json({ received: true, acted: false });
    }

    const acted = await applyPaymentEvent(ctx, database, parsed.event, parsed.payment, raw);
    return json({ received: true, acted });
  });
}

/**
 * Create a gateway order, or hand back the live one already outstanding.
 *
 * The reuse path asks Cashfree rather than trusting what we stored: a
 * `payment_session_id` expires, so the one saved when the attempt began is no
 * use to a buyer returning later. If the gateway says that order is no longer
 * ACTIVE, a fresh one is started — and only then, because two ACTIVE orders
 * for the same basket is how somebody gets charged twice.
 */
async function startOrResume(
  ctx: Ctx,
  config: CashfreeConfig,
  {
    column,
    ownerId,
    reference,
    amountPaise,
    buyerId,
    returnPath,
  }: {
    column: 'order_id' | 'group_id';
    ownerId: string;
    reference: string;
    amountPaise: number;
    buyerId: string;
    returnPath: string;
  },
): Promise<Response> {
  const existing = one(
    await ctx.db.query<{ gateway_order_id: string; amount_paise: string }>(
      // `column` is one of two literals chosen here, never user input.
      `select gateway_order_id, amount_paise::text as amount_paise
         from payments
        where ${column} = $1 and state in ('created', 'authorized')
          and gateway = '${GATEWAY}' and gateway_order_id is not null
        order by created_at desc limit 1`,
      [ownerId],
    ),
  );

  if (existing !== null) {
    let live;
    try {
      live = await fetchOrder(config, existing.gateway_order_id);
    } catch (error) {
      if (error instanceof CashfreeError) {
        return json({ error: 'gateway_error', message: error.message }, error.status);
      }
      throw error;
    }

    if (live !== null && live.status === 'ACTIVE' && live.paymentSessionId !== '') {
      return startedPayment(config, {
        gatewayOrderId: live.id,
        paymentSessionId: live.paymentSessionId,
        amountPaise: Number(existing.amount_paise),
        currency: live.currency,
        reference,
      });
    }

    // Already paid at the gateway but not yet applied here — a webhook that
    // has not landed. Say so rather than opening a second order to be charged.
    if (live !== null && live.status === 'PAID') {
      throw conflict('This payment has already gone through. Give it a moment to appear.');
    }
  }

  const customer = await customerFor(ctx, buyerId);
  const id = gatewayOrderId(reference);

  let created;
  try {
    created = await createGatewayOrder(config, {
      amountPaise,
      orderId: id,
      ...customer,
      returnUrl: `${siteUrl()}${returnPath}`,
      notifyUrl: `${apiUrl()}/v1/webhooks/cashfree`,
      note: reference,
    });
  } catch (error) {
    if (error instanceof CashfreeError) {
      return json({ error: 'gateway_error', message: error.message }, error.status);
    }
    throw error;
  }

  await ctx.db.query(
    `insert into payments (${column}, gateway, gateway_order_id, amount_paise, state)
     values ($1, '${GATEWAY}', $2, $3, 'created')`,
    [ownerId, created.id, amountPaise],
  );

  return startedPayment(config, {
    gatewayOrderId: created.id,
    paymentSessionId: created.paymentSessionId,
    amountPaise,
    currency: created.currency,
    reference,
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
  payment: GatewayPayment,
  raw: string,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    // Lock the payment row so two concurrent deliveries of the same event
    // cannot both pass the state check.
    const found = one(
      await tx.query<{
        id: string;
        order_id: string | null;
        group_id: string | null;
        state: string;
        amount_paise: string;
      }>(
        `select id, order_id, group_id, state, amount_paise::text as amount_paise
           from payments
          where gateway_order_id = $1
          for update`,
        [payment.orderId],
      ),
    );

    // A payment we never created. Record nothing and change nothing — this is
    // either a different integration on the same account, or someone probing.
    if (found === null) return false;

    // A buyer who closed the window has not failed anything; the order stays
    // waiting for them to come back and try again.
    if (event === 'payment.dropped') return false;

    // The amount must be exactly what we asked for. A mismatch means the order
    // was tampered with somewhere, and is never treated as payment.
    if (Number(found.amount_paise) !== payment.amountPaise) {
      console.error(
        `[cashfree] amount mismatch on ${payment.id}: expected ${found.amount_paise}, got ${payment.amountPaise}`,
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

    if (event === 'payment.captured') {
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
      // Already captured — a retry, or the reconciler having got there first.
      if (updated.rows.length === 0) return false;

      // Move the order on, but only from a state that is waiting for money.
      //
      // A basket paid for in one go carries a group rather than an order, and
      // every seller's part of it clears together. One card charge cannot
      // sensibly leave half the basket unpaid.
      await tx.query(
        `update orders
            set state = 'paid'
          where state in ('created', 'payment_pending')
            and (id = $1::uuid
                 or ($2::uuid is not null and group_id = $2::uuid))`,
        [found.order_id, found.group_id],
      );

      await tx.query(
        `update order_items i
            set state = 'paid'
           from orders o
          where i.order_id = o.id
            and i.state in ('created', 'payment_pending')
            and (o.id = $1::uuid
                 or ($2::uuid is not null and o.group_id = $2::uuid))`,
        [found.order_id, found.group_id],
      );

      await tx.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
         values (null, 'payment.captured', 'order', $1::text, $2::inet, $3)`,
        [found.order_id, ctx.ip, 'cashfree-webhook'],
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
 * Ask Cashfree what really happened, and apply it.
 *
 * Webhooks are best-effort. A delivery can be lost, the receiver can be down
 * for a minute, a secret can be mismatched after somebody rotates it — and
 * when that happens the money has still moved. An integration that only
 * listens will eventually take a buyer's payment and leave their order sitting
 * unpaid, which is the worst failure this system has: the buyer is out of
 * pocket and the site says they owe money.
 *
 * It is also what the buyer's own eyes depend on. Cashfree redirects them back
 * here with nothing but an order id, so this lookup is how the page they land
 * on knows what to tell them.
 *
 * Everything goes through the same applyPaymentEvent as a webhook, which means
 * the same amount check, the same idempotency and the same audit line — a
 * reconciled payment is indistinguishable from a delivered one, and running
 * this twice changes nothing.
 *
 * Returns whether anything changed.
 */
export async function reconcileOrder(
  ctx: Ctx,
  database: Database,
  orderId: string,
): Promise<boolean> {
  return reconcile(ctx, database, {
    sql: `select p.gateway_order_id
            from payments p
            join orders o on o.id = p.order_id
           where p.order_id = $1
             and p.gateway_order_id is not null
             and p.gateway = '${GATEWAY}'
             and p.state in ('created', 'authorized')
             and o.state in ('created', 'payment_pending')`,
    id: orderId,
    label: `order ${orderId}`,
  });
}

/** The same, for a basket paid for in one go. */
export async function reconcileGroup(
  ctx: Ctx,
  database: Database,
  groupId: string,
): Promise<boolean> {
  return reconcile(ctx, database, {
    sql: `select p.gateway_order_id
            from payments p
           where p.group_id = $1
             and p.gateway_order_id is not null
             and p.gateway = '${GATEWAY}'
             and p.state in ('created', 'authorized')
             and exists (select 1 from orders o
                          where o.group_id = p.group_id
                            and o.state in ('created', 'payment_pending'))`,
    id: groupId,
    label: `group ${groupId}`,
  });
}

async function reconcile(
  ctx: Ctx,
  database: Database,
  { sql, id, label }: { sql: string; id: string; label: string },
): Promise<boolean> {
  const config = cashfreeConfig();
  if (config === null) return false;

  const rows = await ctx.db.query<{ gateway_order_id: string }>(sql, [id]);

  let changed = false;
  for (const row of rows.rows) {
    let payments;
    try {
      payments = await fetchOrderPayments(config, row.gateway_order_id);
    } catch (error) {
      // A gateway that cannot be reached is not a reason to fail the page the
      // buyer is looking at. Log it and leave the order as it stands.
      console.error('[cashfree] reconcile failed for', row.gateway_order_id, error);
      continue;
    }

    for (const payment of payments) {
      // Only a successful payment moves an order.
      if (payment.status !== 'captured') continue;
      if (
        await applyPaymentEvent(
          ctx,
          database,
          'payment.captured',
          payment,
          JSON.stringify(payment),
        )
      ) {
        console.log(`[cashfree] reconciled ${payment.id} for ${label}`);
        changed = true;
      }
    }
  }

  return changed;
}
