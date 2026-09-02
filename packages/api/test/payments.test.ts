import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody, TEST_IP } from './helpers.ts';
import type { App } from '../src/app.ts';
import {
  checkoutSignatureValid,
  paymentFromWebhook,
  razorpayConfig,
  webhookSignatureValid,
} from '../src/razorpay.ts';

/**
 * Payments.
 *
 * The tests that matter here are the hostile ones. A webhook is an
 * unauthenticated endpoint that moves orders into "paid", so the signature is
 * the only thing between it and anyone marking any order paid — and webhooks
 * retry, so applying one twice must not do the work twice.
 */

const KEY_ID = 'rzp_test_TESTKEY000000';
const KEY_SECRET = 'test-secret-not-a-real-key';
const WEBHOOK_SECRET = 'test-webhook-secret';

let pg: PGlite;
let app: App;

before(async () => {
  process.env['RAZORPAY_KEY_ID'] = KEY_ID;
  process.env['RAZORPAY_KEY_SECRET'] = KEY_SECRET;
  process.env['RAZORPAY_WEBHOOK_SECRET'] = WEBHOOK_SECRET;

  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  delete process.env['RAZORPAY_KEY_ID'];
  delete process.env['RAZORPAY_KEY_SECRET'];
  delete process.env['RAZORPAY_WEBHOOK_SECRET'];
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
  await pg.exec('truncate payments cascade;');
});

let accounts = 0;
async function signUp(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `pay${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

/** A published listing, and a buyer who has placed an order on it. */
async function orderFor(priceInr = 4500): Promise<{ buyer: string; orderId: string }> {
  const seller = await signUp();
  const reg = await request(app, 'POST', '/v1/sellers', {
    token: seller,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller: s } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);

  const created = await request(app, 'POST', '/v1/listings', {
    token: seller,
    body: {
      serial: `9AB ${String(100000 + accounts).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr,
    },
  });
  const { listing } = (await created.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token: seller });

  const buyer = await signUp();
  const ordered = await request(app, 'POST', `/v1/listings/${listing.id}/order`, { token: buyer });
  assert.equal(ordered.status, 201, await ordered.clone().text());
  const { order } = (await ordered.json()) as { order: { id: string } };
  return { buyer, orderId: order.id };
}

/** Post a signed webhook, the way Razorpay would. */
function webhook(body: unknown, secret = WEBHOOK_SECRET): Promise<Response> {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  return app.handle(
    new Request('http://api.test/v1/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
      body: raw,
    }),
    TEST_IP,
  );
}

function capturedEvent(gatewayOrderId: string, amountPaise: number, paymentId = 'pay_TEST1') {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: gatewayOrderId,
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        },
      },
    },
  };
}

/** Stand in for the gateway call, which the tests never make. */
async function fakeGatewayOrder(orderId: string, amountPaise: number): Promise<string> {
  const gatewayOrderId = `order_TEST${Math.random().toString(36).slice(2, 10)}`;
  await pg.query(
    `insert into payments (order_id, gateway, gateway_order_id, amount_paise, state)
     values ($1, 'razorpay', $2, $3, 'created')`,
    [orderId, gatewayOrderId, amountPaise],
  );
  return gatewayOrderId;
}

async function orderState(id: string): Promise<string> {
  const r = await pg.query<{ state: string }>(`select state from orders where id = $1`, [id]);
  return r.rows[0]!.state;
}

async function paymentState(gatewayOrderId: string): Promise<string> {
  const r = await pg.query<{ state: string }>(
    `select state from payments where gateway_order_id = $1`,
    [gatewayOrderId],
  );
  return r.rows[0]!.state;
}

describe('signature checking', () => {
  it('accepts a genuine checkout signature and rejects a forged one', () => {
    const config = razorpayConfig()!;
    const good = createHmac('sha256', KEY_SECRET).update('order_1|pay_1').digest('hex');
    assert.equal(checkoutSignatureValid(config, 'order_1', 'pay_1', good), true);
    assert.equal(checkoutSignatureValid(config, 'order_1', 'pay_1', 'f'.repeat(64)), false);
    // A signature for a different payment must not work for this one.
    assert.equal(checkoutSignatureValid(config, 'order_1', 'pay_2', good), false);
  });

  it('rejects a malformed signature without throwing', () => {
    const config = razorpayConfig()!;
    for (const bad of ['', 'not-hex', 'ab', 'x'.repeat(64)]) {
      assert.equal(checkoutSignatureValid(config, 'order_1', 'pay_1', bad), false);
    }
  });

  it('verifies a webhook over the exact bytes it was signed with', () => {
    const config = razorpayConfig()!;
    const raw = '{"event":"payment.captured","payload":{}}';
    const sig = createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');

    assert.equal(webhookSignatureValid(config, raw, sig), true);
    // Re-serialising changes the bytes, so the signature must fail — which is
    // exactly why the route reads the raw body rather than the parsed object.
    assert.equal(webhookSignatureValid(config, JSON.stringify(JSON.parse(raw)), sig), true);
    assert.equal(webhookSignatureValid(config, `${raw} `, sig), false);
  });

  it('rejects a webhook signed with the API secret instead of the webhook secret', () => {
    const config = razorpayConfig()!;
    const raw = '{"event":"payment.captured"}';
    const wrongKey = createHmac('sha256', KEY_SECRET).update(raw).digest('hex');
    assert.equal(webhookSignatureValid(config, raw, wrongKey), false);
  });
});

describe('starting a payment', () => {
  it('refuses an order belonging to somebody else, with a 404', async () => {
    const { orderId } = await orderFor();
    const stranger = await signUp();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`, { token: stranger });
    assert.equal(res.status, 404, 'a stranger learned that this order exists');
  });

  it('requires signing in', async () => {
    const { orderId } = await orderFor();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`, {});
    assert.equal(res.status, 401);
  });

  it('reports plainly when no gateway is configured', async () => {
    const saved = process.env['RAZORPAY_KEY_ID'];
    delete process.env['RAZORPAY_KEY_ID'];
    try {
      const { buyer, orderId } = await orderFor();
      const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`, { token: buyer });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, 'payments_unavailable');
    } finally {
      process.env['RAZORPAY_KEY_ID'] = saved;
    }
  });
});

describe('the webhook', () => {
  it('refuses an unsigned request', async () => {
    const res = await app.handle(
      new Request('http://api.test/v1/webhooks/razorpay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(capturedEvent('order_X', 450000)),
      }),
      TEST_IP,
    );
    assert.equal(res.status, 401);
  });

  it('refuses a request signed with the wrong secret', async () => {
    const res = await webhook(capturedEvent('order_X', 450000), 'attacker-guess');
    assert.equal(res.status, 401);
  });

  it('marks an order paid on a genuine capture', async () => {
    const { orderId } = await orderFor();
    const total = (
      await pg.query<{ total_paise: string }>(
        `select total_paise::text as total_paise from orders where id = $1`,
        [orderId],
      )
    ).rows[0]!.total_paise;
    const gatewayOrderId = await fakeGatewayOrder(orderId, Number(total));

    assert.equal(await orderState(orderId), 'payment_pending');

    const res = await webhook(capturedEvent(gatewayOrderId, Number(total)));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: true });

    assert.equal(await orderState(orderId), 'paid');
    assert.equal(await paymentState(gatewayOrderId), 'captured');
  });

  it('is idempotent — the same event twice changes nothing the second time', async () => {
    const { orderId } = await orderFor();
    const total = Number(
      (
        await pg.query<{ total_paise: string }>(
          `select total_paise::text as total_paise from orders where id = $1`,
          [orderId],
        )
      ).rows[0]!.total_paise,
    );
    const gatewayOrderId = await fakeGatewayOrder(orderId, total);

    const first = await webhook(capturedEvent(gatewayOrderId, total));
    const second = await webhook(capturedEvent(gatewayOrderId, total));

    assert.deepEqual(await first.json(), { received: true, acted: true });
    assert.deepEqual(await second.json(), { received: true, acted: false }, 'a retry acted twice');

    const count = await pg.query<{ n: string }>(
      `select count(*)::text as n from payments where gateway_order_id = $1`,
      [gatewayOrderId],
    );
    assert.equal(count.rows[0]!.n, '1');
    assert.equal(await orderState(orderId), 'paid');
  });

  it('refuses to accept a payment for less than the order total', async () => {
    const { orderId } = await orderFor(4500);
    const total = Number(
      (
        await pg.query<{ total_paise: string }>(
          `select total_paise::text as total_paise from orders where id = $1`,
          [orderId],
        )
      ).rows[0]!.total_paise,
    );
    const gatewayOrderId = await fakeGatewayOrder(orderId, total);

    // One rupee. If this were accepted, a note could be bought for nothing.
    const res = await webhook(capturedEvent(gatewayOrderId, 100));
    assert.equal(res.status, 200);

    assert.equal(await orderState(orderId), 'payment_pending', 'an underpaid order was marked paid');
    assert.equal(await paymentState(gatewayOrderId), 'failed');
  });

  it('ignores an event for a payment we never created', async () => {
    const { orderId } = await orderFor();
    const res = await webhook(capturedEvent('order_NEVER_SEEN', 450000));
    assert.deepEqual(await res.json(), { received: true, acted: false });
    assert.equal(await orderState(orderId), 'payment_pending');
  });

  it('records a failure without touching the order', async () => {
    const { orderId } = await orderFor();
    const total = Number(
      (
        await pg.query<{ total_paise: string }>(
          `select total_paise::text as total_paise from orders where id = $1`,
          [orderId],
        )
      ).rows[0]!.total_paise,
    );
    const gatewayOrderId = await fakeGatewayOrder(orderId, total);

    const failed = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_FAIL',
            order_id: gatewayOrderId,
            amount: total,
            status: 'failed',
            method: 'card',
            error_description: 'Card declined',
          },
        },
      },
    };
    await webhook(failed);

    assert.equal(await paymentState(gatewayOrderId), 'failed');
    assert.equal(await orderState(orderId), 'payment_pending', 'a failure changed the order');
  });

  it('does not let a later failure undo a captured payment', async () => {
    const { orderId } = await orderFor();
    const total = Number(
      (
        await pg.query<{ total_paise: string }>(
          `select total_paise::text as total_paise from orders where id = $1`,
          [orderId],
        )
      ).rows[0]!.total_paise,
    );
    const gatewayOrderId = await fakeGatewayOrder(orderId, total);

    await webhook(capturedEvent(gatewayOrderId, total));
    await webhook({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_LATE', order_id: gatewayOrderId, amount: total, status: 'failed' },
        },
      },
    });

    assert.equal(await paymentState(gatewayOrderId), 'captured', 'a capture was undone');
    assert.equal(await orderState(orderId), 'paid');
  });

  it('acknowledges an event it cannot act on, so Razorpay stops retrying', async () => {
    const res = await webhook({ event: 'subscription.charged', payload: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: false });
  });
});

describe('the browser callback', () => {
  it('never marks an order paid, however valid its signature', async () => {
    const { buyer, orderId } = await orderFor();
    const total = Number(
      (
        await pg.query<{ total_paise: string }>(
          `select total_paise::text as total_paise from orders where id = $1`,
          [orderId],
        )
      ).rows[0]!.total_paise,
    );
    const gatewayOrderId = await fakeGatewayOrder(orderId, total);

    const signature = createHmac('sha256', KEY_SECRET)
      .update(`${gatewayOrderId}|pay_BROWSER`)
      .digest('hex');

    const res = await request(app, 'POST', '/v1/payments/checkout-callback', {
      token: buyer,
      body: { gatewayOrderId, gatewayPaymentId: 'pay_BROWSER', signature },
    });
    assert.equal(res.status, 200);

    // The signature was genuine and it still did not move the order.
    assert.equal(await orderState(orderId), 'payment_pending', 'the browser marked an order paid');
  });

  it('rejects a forged signature', async () => {
    const { buyer, orderId } = await orderFor();
    const gatewayOrderId = await fakeGatewayOrder(orderId, 450000);
    const res = await request(app, 'POST', '/v1/payments/checkout-callback', {
      token: buyer,
      body: { gatewayOrderId, gatewayPaymentId: 'pay_X', signature: 'a'.repeat(64) },
    });
    assert.equal(res.status, 400);
  });

  it('will not let one buyer attach a payment to another buyer\'s order', async () => {
    const { orderId } = await orderFor();
    const gatewayOrderId = await fakeGatewayOrder(orderId, 450000);
    const stranger = await signUp();

    const signature = createHmac('sha256', KEY_SECRET)
      .update(`${gatewayOrderId}|pay_Y`)
      .digest('hex');

    const res = await request(app, 'POST', '/v1/payments/checkout-callback', {
      token: stranger,
      body: { gatewayOrderId, gatewayPaymentId: 'pay_Y', signature },
    });
    assert.equal(res.status, 404);
  });
});

describe('parsing a webhook envelope', () => {
  it('pulls out the payment', () => {
    const parsed = paymentFromWebhook(capturedEvent('order_1', 12345));
    assert.equal(parsed?.id, 'pay_TEST1');
    assert.equal(parsed?.orderId, 'order_1');
    assert.equal(parsed?.amountPaise, 12345);
    assert.equal(parsed?.method, 'upi');
  });

  it('returns null for anything shaped wrong, rather than throwing', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { payload: {} }, { payload: { payment: {} } }]) {
      assert.equal(paymentFromWebhook(bad), null);
    }
  });
});
