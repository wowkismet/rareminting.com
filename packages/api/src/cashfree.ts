/**
 * Cashfree Payments.
 *
 * Deliberately shaped like razorpay.ts, and deliberately normalising its
 * results into the same `GatewayPayment` the Razorpay code already produces.
 * That is the whole design: `applyPaymentEvent` in routes/payments.ts — the
 * code that decides an order is paid, checks the amount, and keeps replays
 * idempotent — does not learn that a second gateway exists. Money logic that
 * has been tested once stays tested.
 *
 * Three things differ from Razorpay and each is a place a bug would cost real
 * money, so each is handled in exactly one function here:
 *
 *  1. Cashfree talks in RUPEES with two decimals; we hold integer paise
 *     everywhere. Conversion happens in `paiseToRupees`/`rupeesToPaise` and
 *     nowhere else.
 *  2. The webhook signature is base64 HMAC-SHA256 over `timestamp + rawBody`,
 *     keyed by the API secret itself — there is no separate webhook secret to
 *     set, so anyone holding the API key can forge one. That is Cashfree's
 *     design, not ours, and it is why the secret never travels through chat.
 *  3. There is no browser-returned signature. Cashfree redirects the buyer
 *     back to us with nothing but an order id, so the browser is not merely
 *     distrusted — it is never asked. The webhook, and a server-to-server
 *     lookup, are the only sources of truth.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The API version this integration is written against.
 *
 * Pinned, not tracked. Cashfree versions its API by date and changes response
 * shapes between versions; letting this float would mean a payment integration
 * that rewrites itself without anybody deploying.
 */
export const CASHFREE_API_VERSION = '2026-01-01';

export interface CashfreeConfig {
  readonly appId: string;
  readonly secretKey: string;
  readonly baseUrl: string;
  /** True while pointed at the sandbox rather than at real money. */
  readonly isTest: boolean;
}

/**
 * Read the configuration, or report that Cashfree is not set up.
 *
 * Null rather than throwing, matching razorpayConfig: the site works without a
 * gateway, it simply cannot take money.
 *
 * `CASHFREE_MODE` must say `production` in as many words before a real charge
 * is possible. Cashfree's App ID does not carry a `test_` marker the way a
 * Razorpay key does, so there is nothing to infer from — and defaulting to the
 * sandbox means a misconfiguration takes no money rather than taking it
 * wrongly.
 */
export function cashfreeConfig(): CashfreeConfig | null {
  const appId = process.env['CASHFREE_APP_ID'];
  const secretKey = process.env['CASHFREE_SECRET_KEY'];
  if (appId === undefined || appId === '' || secretKey === undefined || secretKey === '') {
    return null;
  }

  const production = process.env['CASHFREE_MODE'] === 'production';
  return {
    appId,
    secretKey,
    baseUrl: production ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg',
    isTest: !production,
  };
}

/* ------------------------------ money ------------------------------ */

/**
 * Paise to the rupee figure Cashfree wants.
 *
 * Returned as a number because the API expects a JSON number, but rounded
 * through a fixed-2 string first so 459900 cannot leave here as 4598.999999.
 */
export function paiseToRupees(paise: number): number {
  if (!Number.isSafeInteger(paise)) {
    throw new CashfreeError('Amounts must be a whole number of paise.', 400);
  }
  return Number((paise / 100).toFixed(2));
}

/**
 * The rupee figure Cashfree reports, back to paise.
 *
 * `Math.round` rather than truncation: 10.15 arrives from JSON as
 * 10.149999999999999, and truncating would make it 1014 paise — a rupee short,
 * silently, on every order ending in an awkward paisa. Rounding gives 1015.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new CashfreeError('The payment provider reported an unreadable amount.', 502);
  }
  return Math.round(rupees * 100);
}

/* --------------------------- signatures --------------------------- */

/** Compare two base64 digests without leaking, through timing, how much matched. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * `x-webhook-timestamp` as milliseconds, or null if it is not a timestamp.
 *
 * Cashfree has been observed sending this in milliseconds, and its own
 * documentation and SDK samples show seconds. Both are accepted rather than
 * one being guessed at: the two are unambiguous by magnitude, since a seconds
 * value for any plausible date is around 1.7e9 and a milliseconds one around
 * 1.7e12, a thousandfold apart with no date this side of the year 5138 able to
 * close the gap.
 *
 * Getting this wrong is silent and total — every webhook fails the age check,
 * the signature is never even computed, and orders quietly stop being marked
 * paid while the gateway says everything was delivered.
 */
function timestampMillis(timestamp: string): number | null {
  if (!/^\d{1,15}$/.test(timestamp)) return null;
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > 1e11 ? value : value * 1000;
}

/**
 * How stale a webhook may be and still be acted on.
 *
 * A day, which is deliberately generous, because the thing this window is
 * protecting against is not worth much and the thing it breaks is.
 *
 * Replaying a captured webhook achieves nothing: `applyPaymentEvent` is
 * idempotent, so a second delivery of a real event changes nothing, and an
 * attacker cannot mint a new one without the secret. Rejecting a late delivery,
 * on the other hand, throws away exactly the retries that exist to save a
 * payment whose first notification was lost — and Cashfree backs its retries
 * off over hours. A tight window here does not harden the endpoint; it disarms
 * the safety net.
 */
const MAX_WEBHOOK_AGE_SECONDS = 24 * 60 * 60;

/**
 * The signature on a webhook.
 *
 * Base64 HMAC-SHA256 of `timestamp + rawBody`, keyed by the API secret. The
 * raw body matters: re-serialising the JSON would renumber `170.00` as `170`
 * and the signature would never match again.
 */
export function webhookSignatureValid(
  config: CashfreeConfig,
  timestamp: string,
  rawBody: string,
  signature: string,
  {
    toleranceSeconds = MAX_WEBHOOK_AGE_SECONDS,
    now = Date.now(),
  }: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  const sentAt = timestampMillis(timestamp);
  if (sentAt === null) return false;
  if (Math.abs(now - sentAt) > toleranceSeconds * 1000) {
    console.error(
      `[cashfree] webhook rejected on age: timestamp ${timestamp}, ${Math.round(
        Math.abs(now - sentAt) / 1000,
      )}s adrift`,
    );
    return false;
  }

  // Signed over the header exactly as it arrived, not over the parsed number —
  // "1700000000000" and 1700000000000 are the same value and different bytes.
  const expected = createHmac('sha256', config.secretKey)
    .update(`${timestamp}${rawBody}`, 'utf8')
    .digest('base64');

  const ok = digestsMatch(expected, signature);
  if (!ok) {
    // Enough to tell a mangled secret from a mangled body next time, without
    // putting either in the log.
    console.error(
      `[cashfree] webhook signature mismatch: timestamp ${timestamp}, body ${rawBody.length} bytes`,
    );
  }
  return ok;
}

/* ----------------------------- errors ----------------------------- */

export class CashfreeError extends Error {
  // A field rather than a constructor parameter property: Node's type
  // stripping runs the source as-is and does not support those.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CashfreeError';
    this.status = status;
  }
}

/* ----------------------------- orders ----------------------------- */

export interface CashfreeOrder {
  /** Our own id, echoed back. This is what a webhook is matched on. */
  readonly id: string;
  /** The handle the browser SDK needs to open checkout. Short-lived. */
  readonly paymentSessionId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly status: string;
}

function headers(config: CashfreeConfig): Record<string, string> {
  return {
    'x-client-id': config.appId,
    'x-client-secret': config.secretKey,
    'x-api-version': CASHFREE_API_VERSION,
    'content-type': 'application/json',
  };
}

/**
 * Create an order at Cashfree.
 *
 * `orderId` is ours and must be unique on the merchant account for all time —
 * Cashfree refuses a repeat — so callers pass an order number with an attempt
 * suffix rather than the bare number.
 *
 * `customerId` and `customerPhone` are required by the API. The phone is the
 * buyer's where we hold one; Cashfree only uses it to offer UPI intents, and a
 * placeholder is better than refusing to let somebody pay.
 */
export async function createGatewayOrder(
  config: CashfreeConfig,
  {
    amountPaise,
    orderId,
    customerId,
    customerPhone,
    customerName,
    customerEmail,
    returnUrl,
    notifyUrl,
    note,
  }: {
    amountPaise: number;
    orderId: string;
    customerId: string;
    customerPhone: string;
    customerName?: string | null;
    customerEmail?: string | null;
    returnUrl: string;
    notifyUrl?: string | null;
    note?: string;
  },
): Promise<CashfreeOrder> {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new CashfreeError('Amount must be a positive whole number of paise.', 400);
  }

  const response = await fetch(`${config.baseUrl}/orders`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: paiseToRupees(amountPaise),
      order_currency: 'INR',
      customer_details: {
        customer_id: customerId,
        customer_phone: customerPhone,
        ...(customerName === null || customerName === undefined
          ? {}
          : { customer_name: customerName }),
        ...(customerEmail === null || customerEmail === undefined
          ? {}
          : { customer_email: customerEmail }),
      },
      order_meta: {
        return_url: returnUrl,
        ...(notifyUrl === null || notifyUrl === undefined ? {} : { notify_url: notifyUrl }),
      },
      ...(note === undefined ? {} : { order_note: note }),
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    // Never surface the gateway's raw error to a buyer; it can carry key
    // fragments and account detail. Log it, return something plain.
    console.error('[cashfree] order creation failed:', response.status, text);
    throw new CashfreeError('The payment provider refused this order.', 502);
  }

  let parsed: {
    order_id?: string;
    payment_session_id?: string;
    order_amount?: number;
    order_currency?: string;
    order_status?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new CashfreeError('The payment provider returned something unreadable.', 502);
  }

  if (typeof parsed.order_id !== 'string' || typeof parsed.payment_session_id !== 'string') {
    throw new CashfreeError('The payment provider returned an incomplete order.', 502);
  }

  return {
    id: parsed.order_id,
    paymentSessionId: parsed.payment_session_id,
    amountPaise:
      typeof parsed.order_amount === 'number' ? rupeesToPaise(parsed.order_amount) : amountPaise,
    currency: parsed.order_currency ?? 'INR',
    status: parsed.order_status ?? 'ACTIVE',
  };
}

/**
 * Fetch an order we already created, to resume paying for it.
 *
 * A `payment_session_id` is short-lived, so the one stored when the attempt
 * started is no use to a buyer coming back an hour later. Asking Cashfree
 * gives the current one — and, more importantly, the current `order_status`,
 * which is how the caller knows whether resuming is possible at all or a fresh
 * order is needed.
 *
 * Null when Cashfree has never heard of it.
 */
export async function fetchOrder(
  config: CashfreeConfig,
  orderId: string,
): Promise<CashfreeOrder | null> {
  const response = await fetch(`${config.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    headers: headers(config),
  });

  if (response.status === 404) return null;

  const text = await response.text();
  if (!response.ok) {
    console.error('[cashfree] order lookup failed:', response.status, text);
    throw new CashfreeError('Could not reach the payment provider.', 502);
  }

  let parsed: {
    order_id?: string;
    payment_session_id?: string;
    order_amount?: number;
    order_currency?: string;
    order_status?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new CashfreeError('The payment provider returned something unreadable.', 502);
  }

  if (typeof parsed.order_id !== 'string') return null;

  return {
    id: parsed.order_id,
    paymentSessionId:
      typeof parsed.payment_session_id === 'string' ? parsed.payment_session_id : '',
    amountPaise: typeof parsed.order_amount === 'number' ? rupeesToPaise(parsed.order_amount) : 0,
    currency: parsed.order_currency ?? 'INR',
    status: parsed.order_status ?? 'UNKNOWN',
  };
}

/* ---------------------------- payments ---------------------------- */

/**
 * One payment, in the shape routes/payments.ts already understands.
 *
 * Identical to Razorpay's `WebhookPayment` on purpose — see the file comment.
 * `amountPaise` is paise by the time it leaves this file.
 */
export interface GatewayPayment {
  readonly id: string;
  readonly orderId: string | null;
  readonly amountPaise: number;
  readonly method: string | null;
  readonly status: string;
  readonly errorDescription: string | null;
}

/** Cashfree's own event names, mapped onto the ones applyPaymentEvent knows. */
export const EVENT_FOR_TYPE: Readonly<Record<string, string>> = {
  PAYMENT_SUCCESS_WEBHOOK: 'payment.captured',
  PAYMENT_FAILED_WEBHOOK: 'payment.failed',
  // A buyer who closed the window has not failed a payment in any sense that
  // should touch the order; it stays waiting for them to try again.
  PAYMENT_USER_DROPPED_WEBHOOK: 'payment.dropped',
  REFUND_STATUS_WEBHOOK: 'refund.processed',
};

/** `status` is normalised to Razorpay's vocabulary, which the routes speak. */
function normaliseStatus(paymentStatus: string): string {
  if (paymentStatus === 'SUCCESS') return 'captured';
  if (paymentStatus === 'FAILED') return 'failed';
  if (paymentStatus === 'USER_DROPPED') return 'dropped';
  return paymentStatus.toLowerCase();
}

function paymentFrom(order: unknown, payment: unknown): GatewayPayment | null {
  if (typeof payment !== 'object' || payment === null) return null;
  const p = payment as Record<string, unknown>;

  // cf_payment_id has been a number in some versions and a string in others.
  const rawId = p['cf_payment_id'];
  const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : null;
  if (id === null) return null;

  const amount = p['payment_amount'];
  if (typeof amount !== 'number') return null;

  // The order id is on the order in a webhook and on the payment itself in a
  // lookup, so both are accepted.
  const o = typeof order === 'object' && order !== null ? (order as Record<string, unknown>) : {};
  const orderId =
    typeof o['order_id'] === 'string'
      ? o['order_id']
      : typeof p['order_id'] === 'string'
        ? p['order_id']
        : null;

  const status = typeof p['payment_status'] === 'string' ? p['payment_status'] : 'UNKNOWN';

  return {
    id,
    orderId,
    amountPaise: rupeesToPaise(amount),
    method: typeof p['payment_group'] === 'string' ? p['payment_group'] : null,
    status: normaliseStatus(status),
    errorDescription: typeof p['payment_message'] === 'string' ? p['payment_message'] : null,
  };
}

export interface CashfreeEvent {
  /** Already translated into the vocabulary applyPaymentEvent expects. */
  readonly event: string;
  readonly payment: GatewayPayment;
}

/** Pull the event and the payment out of a webhook envelope, or null. */
export function eventFromWebhook(body: unknown): CashfreeEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as { type?: unknown; data?: unknown };

  if (typeof envelope.type !== 'string') return null;
  const event = EVENT_FOR_TYPE[envelope.type];
  if (event === undefined) return null;

  if (typeof envelope.data !== 'object' || envelope.data === null) return null;
  const data = envelope.data as { order?: unknown; payment?: unknown };

  const payment = paymentFrom(data.order, data.payment);
  if (payment === null) return null;

  return { event, payment };
}

/**
 * Ask Cashfree what it holds against one of our orders.
 *
 * The counterpart to the webhook, and the reason reconciliation is possible.
 * Webhooks are best-effort — a delivery can be lost, a receiver can be down —
 * and an integration that only listens will eventually take somebody's money
 * without noticing.
 *
 * A 404 means Cashfree has never heard of the order, which is not an error
 * worth raising: it is the normal answer for an attempt that was abandoned
 * before the buyer reached the payment page.
 */
export async function fetchOrderPayments(
  config: CashfreeConfig,
  orderId: string,
): Promise<GatewayPayment[]> {
  const response = await fetch(
    `${config.baseUrl}/orders/${encodeURIComponent(orderId)}/payments`,
    { headers: headers(config) },
  );

  if (response.status === 404) return [];

  const text = await response.text();
  if (!response.ok) {
    console.error('[cashfree] payment lookup failed:', response.status, text);
    throw new CashfreeError('Could not reach the payment provider.', 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CashfreeError('The payment provider returned something unreadable.', 502);
  }

  const items = Array.isArray(parsed) ? parsed : [];
  return items
    .map((entity) => paymentFrom(null, entity))
    .filter((p): p is GatewayPayment => p !== null)
    // A lookup returns the payment without repeating the order id in some
    // versions; we asked about one order, so we know what it is.
    .map((p) => (p.orderId === null ? { ...p, orderId } : p));
}
