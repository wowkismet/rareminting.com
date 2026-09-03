/**
 * Razorpay.
 *
 * Two rules shape this file.
 *
 * The first: the browser is never believed. After checkout, Razorpay hands the
 * browser a signature, and the browser hands it to us. That is a convenience —
 * it lets us show the buyer a result immediately — but a determined buyer
 * controls their own browser, so it is never what marks an order paid. The
 * webhook, which arrives server-to-server and is signed with a different
 * secret, is the authority.
 *
 * The second: every signature comparison is timing-safe. A comparison that
 * returns early on the first wrong byte leaks, over enough attempts, how much
 * of a forged signature was right.
 *
 * Amounts are integer paise throughout, which is also what Razorpay expects,
 * so nothing is ever converted to a float on the way in or out.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RazorpayConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string | null;
  /** True when the keys are Razorpay's test keys rather than live ones. */
  readonly isTest: boolean;
}

/**
 * Read the configuration, or report that payments are off.
 *
 * Returns null rather than throwing: the site works without a gateway, it just
 * cannot take money, and every caller has something sensible to say in that
 * case.
 */
export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env['RAZORPAY_KEY_ID'];
  const keySecret = process.env['RAZORPAY_KEY_SECRET'];
  if (keyId === undefined || keyId === '' || keySecret === undefined || keySecret === '') {
    return null;
  }
  const webhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'];
  return {
    keyId,
    keySecret,
    webhookSecret: webhookSecret === undefined || webhookSecret === '' ? null : webhookSecret,
    isTest: keyId.startsWith('rzp_test_'),
  };
}

export function paymentsEnabled(): boolean {
  return razorpayConfig() !== null;
}

/** Compare two hex digests without leaking, through timing, how much matched. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * The signature Razorpay's checkout returns to the browser.
 *
 * HMAC-SHA256 of "<order_id>|<payment_id>" keyed by the API secret.
 */
export function checkoutSignatureValid(
  config: RazorpayConfig,
  gatewayOrderId: string,
  gatewayPaymentId: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', config.keySecret)
    .update(`${gatewayOrderId}|${gatewayPaymentId}`, 'utf8')
    .digest('hex');
  return digestsMatch(expected, signature);
}

/**
 * The signature on a webhook, over the raw request body.
 *
 * Keyed by the webhook secret, which is set separately from the API secret in
 * the Razorpay dashboard — so a leaked API key alone cannot forge a webhook.
 */
export function webhookSignatureValid(
  config: RazorpayConfig,
  rawBody: string,
  signature: string,
): boolean {
  if (config.webhookSecret === null) return false;
  const expected = createHmac('sha256', config.webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  return digestsMatch(expected, signature);
}

export interface GatewayOrder {
  readonly id: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly status: string;
}

export class RazorpayError extends Error {
  // Declared as a field rather than a constructor parameter property: Node's
  // type stripping runs the source as-is and does not support those.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RazorpayError';
    this.status = status;
  }
}

/**
 * Create an order at Razorpay.
 *
 * `receipt` is our own order number, which is how a payment is traced back to
 * an order during reconciliation. `notes` carries our order id so the webhook
 * can be matched even if a receipt is ever reused.
 */
export async function createGatewayOrder(
  config: RazorpayConfig,
  {
    amountPaise,
    receipt,
    notes,
  }: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<GatewayOrder> {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new RazorpayError('Amount must be a positive whole number of paise.', 400);
  }

  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes,
      // Capture automatically: holding an authorisation we never capture would
      // leave the buyer's money blocked with nothing to show for it.
      payment_capture: 1,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    // Never surface the gateway's raw error to a buyer; it can carry key
    // fragments and account detail. Log it, return something plain.
    console.error('[razorpay] order creation failed:', response.status, text);
    throw new RazorpayError('The payment provider refused this order.', 502);
  }

  let parsed: { id?: string; amount?: number; currency?: string; status?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new RazorpayError('The payment provider returned something unreadable.', 502);
  }

  if (typeof parsed.id !== 'string' || typeof parsed.amount !== 'number') {
    throw new RazorpayError('The payment provider returned an incomplete order.', 502);
  }

  return {
    id: parsed.id,
    amountPaise: parsed.amount,
    currency: parsed.currency ?? 'INR',
    status: parsed.status ?? 'created',
  };
}

/** The webhook events we act on. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = [
  'payment.captured',
  'payment.failed',
  'order.paid',
  'refund.processed',
] as const;

export interface WebhookPayment {
  readonly id: string;
  readonly orderId: string | null;
  readonly amountPaise: number;
  readonly method: string | null;
  readonly status: string;
  readonly errorDescription: string | null;
}

/** Pull the payment out of a webhook envelope, or null if it carries none. */
export function paymentFromWebhook(body: unknown): WebhookPayment | null {
  if (typeof body !== 'object' || body === null) return null;
  const payload = (body as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const entity = (payload as { payment?: { entity?: unknown } }).payment?.entity;
  if (typeof entity !== 'object' || entity === null) return null;

  const e = entity as Record<string, unknown>;
  if (typeof e['id'] !== 'string' || typeof e['amount'] !== 'number') return null;

  return {
    id: e['id'],
    orderId: typeof e['order_id'] === 'string' ? e['order_id'] : null,
    amountPaise: e['amount'],
    method: typeof e['method'] === 'string' ? e['method'] : null,
    status: typeof e['status'] === 'string' ? e['status'] : 'unknown',
    errorDescription:
      typeof e['error_description'] === 'string' ? e['error_description'] : null,
  };
}

/**
 * Fetch the payments Razorpay holds against one of our gateway orders.
 *
 * The counterpart to the webhook, and the reason reconciliation is possible at
 * all: the gateway always knows the truth, even when its notification never
 * arrived. Webhooks are best-effort — a delivery can be lost, a receiver can be
 * down, a secret can be mismatched — so a payment integration that only listens
 * will eventually take somebody's money without noticing.
 */
export async function fetchOrderPayments(
  config: RazorpayConfig,
  gatewayOrderId: string,
): Promise<WebhookPayment[]> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  const response = await fetch(
    `https://api.razorpay.com/v1/orders/${encodeURIComponent(gatewayOrderId)}/payments`,
    { headers: { authorization: `Basic ${auth}` } },
  );

  const text = await response.text();
  if (!response.ok) {
    console.error('[razorpay] payment lookup failed:', response.status, text);
    throw new RazorpayError('Could not reach the payment provider.', 502);
  }

  let parsed: { items?: unknown[] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new RazorpayError('The payment provider returned something unreadable.', 502);
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items
    .map((entity) => {
      if (typeof entity !== 'object' || entity === null) return null;
      const e = entity as Record<string, unknown>;
      if (typeof e['id'] !== 'string' || typeof e['amount'] !== 'number') return null;
      return {
        id: e['id'],
        orderId: typeof e['order_id'] === 'string' ? e['order_id'] : null,
        amountPaise: e['amount'],
        method: typeof e['method'] === 'string' ? e['method'] : null,
        status: typeof e['status'] === 'string' ? e['status'] : 'unknown',
        errorDescription:
          typeof e['error_description'] === 'string' ? e['error_description'] : null,
      } satisfies WebhookPayment;
    })
    .filter((p): p is WebhookPayment => p !== null);
}
