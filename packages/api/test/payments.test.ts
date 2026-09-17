import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

import {
  approveSeller,
  createRig,
  request,
  addAddress,
  reset,
  sellerBody,
  TEST_IP,
} from './helpers.ts';
import type { App } from '../src/app.ts';
import {
  cashfreeConfig,
  eventFromWebhook,
  paiseToRupees,
  rupeesToPaise,
  webhookSignatureValid,
} from '../src/cashfree.ts';

/**
 * Payments, through Cashfree.
 *
 * The tests that matter here are the hostile ones. A webhook is an
 * unauthenticated endpoint that moves orders into "paid", so the signature is
 * the only thing between it and anyone marking any order paid — and webhooks
 * retry, so applying one twice must not do the work twice.
 *
 * The other theme is arithmetic. Cashfree talks in rupees with two decimals
 * and this system holds integer paise, so every amount crosses a conversion on
 * the way in and on the way out. A rounding bug there is a real loss on every
 * order, and it is the kind that goes unnoticed for months.
 */

const APP_ID = 'TEST0000000000000000000000';
const SECRET = 'cfsk_test_not_a_real_key';

let pg: PGlite;
let app: App;

before(async () => {
  process.env['CASHFREE_APP_ID'] = APP_ID;
  process.env['CASHFREE_SECRET_KEY'] = SECRET;
  // Left unset on purpose: anything but "production" must point at the
  // sandbox, and a test suite is never allowed near real money.
  delete process.env['CASHFREE_MODE'];

  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  delete process.env['CASHFREE_APP_ID'];
  delete process.env['CASHFREE_SECRET_KEY'];
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
  await addAddress(app, buyer);
  const ordered = await request(app, 'POST', `/v1/listings/${listing.id}/order`, { token: buyer });
  assert.equal(ordered.status, 201, await ordered.clone().text());
  const { order } = (await ordered.json()) as { order: { id: string } };
  return { buyer, orderId: order.id };
}

/** Sign and post a webhook, the way Cashfree would. */
function webhook(
  body: unknown,
  { secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000)) } = {},
): Promise<Response> {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(`${timestamp}${raw}`, 'utf8').digest('base64');
  return app.handle(
    new Request('http://api.test/v1/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      },
      body: raw,
    }),
    TEST_IP,
  );
}

/** Cashfree reports rupees, so every fixture here is built from rupees. */
function successEvent(gatewayOrderId: string, amountPaise: number, paymentId = '1453002795') {
  const rupees = paiseToRupees(amountPaise);
  return {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_time: new Date().toISOString(),
    data: {
      order: { order_id: gatewayOrderId, order_amount: rupees, order_currency: 'INR' },
      payment: {
        cf_payment_id: paymentId,
        payment_status: 'SUCCESS',
        payment_amount: rupees,
        payment_currency: 'INR',
        payment_message: '00::Transaction success',
        payment_group: 'upi',
      },
    },
  };
}

/** Stand in for the gateway call, which the tests never make. */
async function fakeGatewayOrder(orderId: string, amountPaise: number): Promise<string> {
  const gatewayOrderId = `RM-TEST-${Math.random().toString(36).slice(2, 10)}`;
  await pg.query(
    `insert into payments (order_id, gateway, gateway_order_id, amount_paise, state)
     values ($1, 'cashfree', $2, $3, 'created')`,
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

describe('money crossing the gateway boundary', () => {
  it('converts paise to the rupee figure Cashfree wants', () => {
    assert.equal(paiseToRupees(449900), 4499);
    assert.equal(paiseToRupees(1015), 10.15);
    assert.equal(paiseToRupees(1), 0.01);
    assert.equal(paiseToRupees(0), 0);
  });

  it('converts the rupee figure back without losing a paisa', () => {
    // 10.15 cannot be represented exactly in binary floating point; it arrives
    // from JSON as 10.149999999999999. Truncating would make this 1014 and
    // quietly short every such order by a paisa.
    assert.equal(rupeesToPaise(10.15), 1015);
    assert.equal(rupeesToPaise(4499), 449900);
    assert.equal(rupeesToPaise(0.01), 1);
    assert.equal(rupeesToPaise(170.0), 17000);
  });

  it('round-trips every amount it is given', () => {
    for (const paise of [1, 99, 100, 1015, 4499_00, 12_345_67, 99_99_999]) {
      assert.equal(rupeesToPaise(paiseToRupees(paise)), paise, `${paise} did not survive`);
    }
  });

  it('refuses a fractional paisa rather than rounding money away', () => {
    assert.throws(() => paiseToRupees(10.5));
  });
});

describe('signature checking', () => {
  it('accepts a genuine signature and rejects a forged one', () => {
    const config = cashfreeConfig()!;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const good = createHmac('sha256', SECRET).update(`${timestamp}${raw}`, 'utf8').digest('base64');

    assert.equal(webhookSignatureValid(config, timestamp, raw, good), true);
    assert.equal(webhookSignatureValid(config, timestamp, raw, 'AAAA'), false);
    assert.equal(webhookSignatureValid(config, timestamp, `${raw} `, good), false);
  });

  it('signs the timestamp and body together, not the body alone', () => {
    // Signing only the body would let a captured webhook be replayed for ever.
    const config = cashfreeConfig()!;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = '{"a":1}';
    const bodyOnly = createHmac('sha256', SECRET).update(raw, 'utf8').digest('base64');
    assert.equal(webhookSignatureValid(config, timestamp, raw, bodyOnly), false);
  });

  it('refuses a signature that is old, however well formed', () => {
    const config = cashfreeConfig()!;
    const raw = '{"a":1}';
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = createHmac('sha256', SECRET).update(`${old}${raw}`, 'utf8').digest('base64');

    assert.equal(webhookSignatureValid(config, old, raw, signature), false);
    // ...and is accepted when the clock is wound back to when it was sent.
    assert.equal(
      webhookSignatureValid(config, old, raw, signature, { now: Number(old) * 1000 }),
      true,
    );
  });

  it('rejects a malformed signature or timestamp without throwing', () => {
    const config = cashfreeConfig()!;
    const timestamp = String(Math.floor(Date.now() / 1000));
    assert.equal(webhookSignatureValid(config, timestamp, 'body', 'not base64 !!'), false);
    assert.equal(webhookSignatureValid(config, timestamp, 'body', ''), false);
    assert.equal(webhookSignatureValid(config, 'yesterday', 'body', 'AAAA'), false);
  });

  it('stays on the sandbox unless production is spelled out', () => {
    assert.equal(cashfreeConfig()!.isTest, true);
    assert.match(cashfreeConfig()!.baseUrl, /sandbox\.cashfree\.com/);

    process.env['CASHFREE_MODE'] = 'production';
    try {
      assert.equal(cashfreeConfig()!.isTest, false);
      assert.equal(cashfreeConfig()!.baseUrl, 'https://api.cashfree.com/pg');
    } finally {
      delete process.env['CASHFREE_MODE'];
    }

    // Anything that is not exactly "production" is the sandbox. A typo must
    // not be the thing standing between a test and a real charge.
    process.env['CASHFREE_MODE'] = 'Production';
    try {
      assert.equal(cashfreeConfig()!.isTest, true);
    } finally {
      delete process.env['CASHFREE_MODE'];
    }
  });
});

describe('starting a payment', () => {
  it('refuses an order belonging to somebody else, with a 404', async () => {
    const { orderId } = await orderFor();
    const stranger = await signUp();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`, { token: stranger });
    assert.equal(res.status, 404);
  });

  it('requires signing in', async () => {
    const { orderId } = await orderFor();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`);
    assert.equal(res.status, 401);
  });

  it('reports plainly when no gateway is configured', async () => {
    const { buyer, orderId } = await orderFor();
    const appId = process.env['CASHFREE_APP_ID'];
    delete process.env['CASHFREE_APP_ID'];
    try {
      const res = await request(app, 'POST', `/v1/orders/${orderId}/payment`, { token: buyer });
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: string; message: string };
      assert.equal(body.error, 'payments_unavailable');
      // The buyer needs to know their order survived and they were not charged.
      assert.match(body.message, /nothing was charged/i);
    } finally {
      process.env['CASHFREE_APP_ID'] = appId;
    }
  });
});

describe('the webhook', () => {
  it('refuses an unsigned request', async () => {
    const res = await app.handle(
      new Request('http://api.test/v1/webhooks/cashfree', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(successEvent('RM-TEST-x', 100)),
      }),
      TEST_IP,
    );
    assert.equal(res.status, 401);
  });

  it('refuses a request signed with the wrong secret', async () => {
    const res = await webhook(successEvent('RM-TEST-x', 100), { secret: 'not-the-secret' });
    assert.equal(res.status, 401);
  });

  it('refuses a replay from an hour ago', async () => {
    const { orderId } = await orderFor();
    const gatewayOrderId = await fakeGatewayOrder(orderId, 456_000);
    const old = String(Math.floor(Date.now() / 1000) - 3600);

    const before = await orderState(orderId);
    const res = await webhook(successEvent(gatewayOrderId, 456_000), { timestamp: old });
    assert.equal(res.status, 401);
    assert.equal(await orderState(orderId), before, 'a stale replay must move nothing');
  });

  it('marks an order paid on a genuine success', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);

    const res = await webhook(successEvent(gatewayOrderId, amount));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: true });

    assert.equal(await orderState(orderId), 'paid');
    assert.equal(await paymentState(gatewayOrderId), 'captured');
  });

  it('is idempotent — the same event twice changes nothing the second time', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);

    const first = await webhook(successEvent(gatewayOrderId, amount));
    assert.deepEqual(await first.json(), { received: true, acted: true });

    const second = await webhook(successEvent(gatewayOrderId, amount));
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: true, acted: false });

    const audits = await pg.query<{ n: string }>(
      `select count(*)::text as n from audit_logs
        where action = 'payment.captured' and entity_id = $1`,
      [orderId],
    );
    assert.equal(audits.rows[0]!.n, '1', 'a retry must not write a second audit line');
  });

  it('refuses to accept a payment for less than the order total', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);
    const before = await orderState(orderId);

    // One rupee short.
    const res = await webhook(successEvent(gatewayOrderId, amount - 100));
    assert.equal(res.status, 200);

    assert.equal(await orderState(orderId), before, 'a short payment must not pay an order');
    assert.equal(await paymentState(gatewayOrderId), 'failed');
  });

  it('ignores an event for a payment we never created', async () => {
    const res = await webhook(successEvent('RM-SOMEBODY-ELSE', 500_00));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: false });
  });

  it('records a failure without touching the order', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);
    const before = await orderState(orderId);

    const failed = {
      type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: gatewayOrderId, order_amount: paiseToRupees(amount) },
        payment: {
          cf_payment_id: '999',
          payment_status: 'FAILED',
          payment_amount: paiseToRupees(amount),
          payment_message: 'Insufficient funds',
          payment_group: 'credit_card',
        },
      },
    };

    const res = await webhook(failed);
    assert.equal(res.status, 200);
    assert.equal(await paymentState(gatewayOrderId), 'failed');
    assert.equal(await orderState(orderId), before, 'the buyer can still try again');
  });

  it('leaves the order alone when the buyer simply closed the window', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);
    const before = await orderState(orderId);

    const dropped = {
      type: 'PAYMENT_USER_DROPPED_WEBHOOK',
      data: {
        order: { order_id: gatewayOrderId, order_amount: paiseToRupees(amount) },
        payment: {
          cf_payment_id: '1000',
          payment_status: 'USER_DROPPED',
          payment_amount: paiseToRupees(amount),
          payment_group: 'upi',
        },
      },
    };

    const res = await webhook(dropped);
    assert.equal(res.status, 200);
    // Walking away is not a failed payment. The attempt stays open so the
    // buyer can come back to it.
    assert.equal(await paymentState(gatewayOrderId), 'created');
    assert.equal(await orderState(orderId), before);
  });

  it('does not let a later failure undo a captured payment', async () => {
    const { orderId } = await orderFor(4500);
    const total = await pg.query<{ total_paise: string }>(
      `select total_paise::text as total_paise from orders where id = $1`,
      [orderId],
    );
    const amount = Number(total.rows[0]!.total_paise);
    const gatewayOrderId = await fakeGatewayOrder(orderId, amount);

    await webhook(successEvent(gatewayOrderId, amount));
    assert.equal(await paymentState(gatewayOrderId), 'captured');

    // Out-of-order delivery: the failure for an earlier attempt arrives after
    // the success. It must not unpay the order.
    await webhook({
      type: 'PAYMENT_FAILED_WEBHOOK',
      data: {
        order: { order_id: gatewayOrderId, order_amount: paiseToRupees(amount) },
        payment: {
          cf_payment_id: '998',
          payment_status: 'FAILED',
          payment_amount: paiseToRupees(amount),
          payment_message: 'Declined',
        },
      },
    });

    assert.equal(await paymentState(gatewayOrderId), 'captured');
    assert.equal(await orderState(orderId), 'paid');
  });

  it('acknowledges an event it cannot act on, so Cashfree stops retrying', async () => {
    const res = await webhook({ type: 'SOMETHING_NEW_WEBHOOK', data: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: false });
  });
});

describe('parsing a webhook envelope', () => {
  it('pulls out the payment and translates the event name', () => {
    const parsed = eventFromWebhook(successEvent('RM-TEST-1', 449900));
    assert.ok(parsed !== null);
    assert.equal(parsed.event, 'payment.captured');
    assert.equal(parsed.payment.id, '1453002795');
    assert.equal(parsed.payment.orderId, 'RM-TEST-1');
    assert.equal(parsed.payment.amountPaise, 449900, 'rupees must arrive as paise');
    assert.equal(parsed.payment.status, 'captured');
    assert.equal(parsed.payment.method, 'upi');
  });

  it('accepts a numeric payment id as well as a string one', () => {
    const body = successEvent('RM-TEST-2', 100);
    (body.data.payment as { cf_payment_id: unknown }).cf_payment_id = 1453002795;
    const parsed = eventFromWebhook(body);
    assert.ok(parsed !== null);
    assert.equal(parsed.payment.id, '1453002795');
  });

  it('returns null for anything shaped wrong, rather than throwing', () => {
    assert.equal(eventFromWebhook(null), null);
    assert.equal(eventFromWebhook({}), null);
    assert.equal(eventFromWebhook({ type: 'PAYMENT_SUCCESS_WEBHOOK' }), null);
    assert.equal(eventFromWebhook({ type: 'UNKNOWN', data: { payment: {} } }), null);
    assert.equal(
      eventFromWebhook({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { payment: { cf_payment_id: 'x' } } }),
      null,
      'a payment with no amount is not a payment',
    );
  });
});
