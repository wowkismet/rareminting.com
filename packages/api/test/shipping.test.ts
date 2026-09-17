import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import {
  addAddress,
  approveSeller,
  createRig,
  request,
  reset,
  sellerBody,
  TEST_IP,
} from './helpers.ts';
import type { App } from '../src/app.ts';
import { DEFAULT_PARCEL, orderStateFor, shiprocketConfig } from '../src/shiprocket.ts';

/**
 * Delivery through Shiprocket.
 *
 * The tests that earn their place here are the ones about who may do what and
 * what happens when the courier is unreachable. Booking a parcel costs money
 * and produces a tracking number a buyer is then given, so booking twice is a
 * real loss, and letting the wrong person read an AWB hands them somebody
 * else's address.
 *
 * The calls to Shiprocket itself are not made: there is no sandbox on that
 * account, and a suite that books real couriers is a suite nobody dares run.
 * What is tested is everything around the call — the guards, the state
 * machine, and the webhook.
 */

let pg: PGlite;
let app: App;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  delete process.env['SHIPROCKET_EMAIL'];
  delete process.env['SHIPROCKET_PASSWORD'];
  delete process.env['SHIPROCKET_WEBHOOK_TOKEN'];
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
  delete process.env['SHIPROCKET_EMAIL'];
  delete process.env['SHIPROCKET_PASSWORD'];
  delete process.env['SHIPROCKET_WEBHOOK_TOKEN'];
});

let n = 0;

async function signUp(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `ship${n}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

/** A paid order, with the seller's and buyer's tokens. */
async function paidOrder(): Promise<{
  orderId: string;
  buyer: string;
  seller: string;
}> {
  const seller = await signUp();
  const reg = await request(app, 'POST', '/v1/sellers', { token: seller, body: sellerBody() });
  const { seller: s } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);

  n += 1;
  const made = await request(app, 'POST', '/v1/listings', {
    token: seller,
    body: {
      serial: `9AB${String(700000 + n).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr: 4500,
    },
  });
  const { listing } = (await made.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token: seller });

  const buyer = await signUp();
  await addAddress(app, buyer);
  await request(app, 'POST', '/v1/cart', { token: buyer, body: { listingId: listing.id } });
  const checkout = await request(app, 'POST', '/v1/cart/checkout', { token: buyer, body: {} });
  assert.equal(checkout.status, 201, await checkout.clone().text());
  const { orders } = (await checkout.json()) as { orders: { id: string }[] };
  const orderId = orders[0]!.id;

  // Straight to paid: how it got there is payments.test.ts's business.
  await pg.query(`update orders set state = 'paid' where id = $1`, [orderId]);
  await pg.query(`update order_items set state = 'paid' where order_id = $1`, [orderId]);

  return { orderId, buyer, seller };
}

function configure(): void {
  process.env['SHIPROCKET_EMAIL'] = 'someone@example.com';
  process.env['SHIPROCKET_PASSWORD'] = 'not-a-real-password';
}

function webhook(body: unknown, key = 'test-webhook-token'): Promise<Response> {
  return app.handle(
    new Request('http://api.test/v1/webhooks/shiprocket', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(body),
    }),
    TEST_IP,
  );
}

async function orderRow(id: string): Promise<Record<string, unknown>> {
  const r = await pg.query<Record<string, unknown>>(
    `select state::text as state, awb, shipment_status,
            shipped_at::text as shipped_at, delivered_at::text as delivered_at
       from orders where id = $1`,
    [id],
  );
  return r.rows[0]!;
}

describe('configuration', () => {
  it('reports the courier as off until both halves are set', () => {
    assert.equal(shiprocketConfig(), null);

    process.env['SHIPROCKET_EMAIL'] = 'someone@example.com';
    assert.equal(shiprocketConfig(), null, 'an email without a password is not configured');

    process.env['SHIPROCKET_PASSWORD'] = 'x';
    const config = shiprocketConfig();
    assert.ok(config !== null);
    assert.equal(config.email, 'someone@example.com');
    // Shiprocket refuses an order naming a pickup point it does not know, so
    // there has to be a default rather than an empty string.
    assert.equal(config.pickupLocation, 'Primary');
  });

  it('declares a parcel rather than shipping a weightless one', () => {
    // Shiprocket rejects a shipment with no weight, and under-declaring gets
    // it re-weighed at the hub and billed back with a penalty.
    assert.ok(DEFAULT_PARCEL.weightKg > 0);
    assert.ok(DEFAULT_PARCEL.lengthCm > 0);
    assert.ok(DEFAULT_PARCEL.breadthCm > 0);
    assert.ok(DEFAULT_PARCEL.heightCm > 0);
  });
});

describe('mapping courier status onto an order', () => {
  it('moves an order only for the two statuses that mean something here', () => {
    assert.equal(orderStateFor('DELIVERED'), 'delivered');
    assert.equal(orderStateFor('PICKED UP'), 'shipped');
    assert.equal(orderStateFor('IN TRANSIT'), 'shipped');
    assert.equal(orderStateFor('SHIPPED'), 'shipped');
  });

  it('leaves the order alone for everything else', () => {
    // An order does not need a state for "reached destination hub". Letting
    // every courier's vocabulary become an order state is how a state machine
    // stops being one.
    assert.equal(orderStateFor('REACHED DESTINATION HUB'), null);
    assert.equal(orderStateFor('OUT FOR DELIVERY'), null);
    assert.equal(orderStateFor('RTO INITIATED'), null);
    assert.equal(orderStateFor('anything at all'), null);
  });

  it('is not fooled by case or stray spacing', () => {
    assert.equal(orderStateFor('  delivered  '), 'delivered');
    assert.equal(orderStateFor('Picked Up'), 'shipped');
  });
});

describe('booking a parcel', () => {
  it('says plainly when the courier is not connected', async () => {
    const { orderId, seller } = await paidOrder();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`, { token: seller });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'shipping_unavailable');
    assert.match(body.message, /nothing has been booked/i);
  });

  it('refuses a stranger, as a 404', async () => {
    configure();
    const { orderId } = await paidOrder();
    const stranger = await signUp();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`, { token: stranger });
    assert.equal(res.status, 404);
  });

  it('refuses the buyer — it is the seller who holds the note', async () => {
    configure();
    const { orderId, buyer } = await paidOrder();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`, { token: buyer });
    assert.equal(res.status, 404);
  });

  it('requires signing in', async () => {
    configure();
    const { orderId } = await paidOrder();
    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`);
    assert.equal(res.status, 401);
  });

  it('will not ship an order that has not been paid for', async () => {
    configure();
    const { orderId, seller } = await paidOrder();
    await pg.query(`update orders set state = 'payment_pending' where id = $1`, [orderId]);

    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`, { token: seller });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { message: string }).message, /only a paid order/i);
  });

  it('hands back the existing parcel rather than booking a second', async () => {
    configure();
    const { orderId, seller } = await paidOrder();
    await pg.query(
      `update orders set awb = 'AWB123456', courier_name = 'Delhivery',
              shipment_status = 'AWB assigned' where id = $1`,
      [orderId],
    );

    // Never reaches Shiprocket: booking twice is a second charge and a second
    // tracking number the buyer was never given.
    const res = await request(app, 'POST', `/v1/orders/${orderId}/ship`, { token: seller });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { alreadyBooked: boolean; awb: string };
    assert.equal(body.alreadyBooked, true);
    assert.equal(body.awb, 'AWB123456');
  });
});

describe('tracking', () => {
  it('lets the buyer see it', async () => {
    const { orderId, buyer } = await paidOrder();
    const res = await request(app, 'GET', `/v1/orders/${orderId}/tracking`, { token: buyer });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { booked: boolean };
    assert.equal(body.booked, false, 'nothing is booked yet, and it says so');
  });

  it('never shows one buyer another buyer’s parcel', async () => {
    const { orderId } = await paidOrder();
    await pg.query(`update orders set awb = 'AWB999' where id = $1`, [orderId]);

    const stranger = await signUp();
    const res = await request(app, 'GET', `/v1/orders/${orderId}/tracking`, { token: stranger });
    // The AWB would give away the delivery address at the courier's own site.
    assert.equal(res.status, 404);
  });

  it('still gives the number when the courier cannot be reached', async () => {
    const { orderId, buyer } = await paidOrder();
    await pg.query(
      `update orders set awb = 'AWB777', courier_name = 'Bluedart',
              shipment_status = 'In Transit' where id = $1`,
      [orderId],
    );

    // Unconfigured stands in for unreachable: either way the buyer gets the
    // number, which they can paste into the courier's own site.
    const res = await request(app, 'GET', `/v1/orders/${orderId}/tracking`, { token: buyer });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { awb: string; live: boolean; status: string };
    assert.equal(body.awb, 'AWB777');
    assert.equal(body.live, false);
    assert.equal(body.status, 'In Transit');
  });
});

describe('the courier webhook', () => {
  it('refuses a request with no token, and one with the wrong token', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const { orderId } = await paidOrder();
    await pg.query(`update orders set awb = 'AWB555' where id = $1`, [orderId]);

    assert.equal((await webhook({ awb: 'AWB555', current_status: 'DELIVERED' }, '')).status, 401);
    assert.equal(
      (await webhook({ awb: 'AWB555', current_status: 'DELIVERED' }, 'wrong')).status,
      401,
    );
    assert.equal((await orderRow(orderId))['state'], 'paid', 'nothing moved');
  });

  it('refuses everything while no token is configured', async () => {
    const res = await webhook({ awb: 'AWB1', current_status: 'DELIVERED' });
    assert.equal(res.status, 503);
  });

  it('marks an order delivered', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const { orderId } = await paidOrder();
    await pg.query(`update orders set awb = 'AWB111', state = 'shipped' where id = $1`, [orderId]);

    const res = await webhook({ awb: 'AWB111', current_status: 'DELIVERED' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: true });

    const row = await orderRow(orderId);
    assert.equal(row['state'], 'delivered');
    assert.notEqual(row['delivered_at'], null);
  });

  it('records a status that means nothing here without moving the order', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const { orderId } = await paidOrder();
    await pg.query(`update orders set awb = 'AWB222', state = 'shipped' where id = $1`, [orderId]);

    await webhook({ awb: 'AWB222', current_status: 'REACHED DESTINATION HUB' });

    const row = await orderRow(orderId);
    assert.equal(row['shipment_status'], 'REACHED DESTINATION HUB');
    assert.equal(row['state'], 'shipped', 'the order state is not the courier’s to invent');
  });

  it('ignores an AWB we have never heard of', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const res = await webhook({ awb: 'SOMEBODY-ELSES', current_status: 'DELIVERED' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: false });
  });

  it('acknowledges a payload it cannot act on, so retries stop', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const res = await webhook({ something: 'unexpected' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, acted: false });
  });

  it('does not un-deliver a parcel that has already arrived', async () => {
    process.env['SHIPROCKET_WEBHOOK_TOKEN'] = 'test-webhook-token';
    const { orderId } = await paidOrder();
    await pg.query(`update orders set awb = 'AWB333', state = 'shipped' where id = $1`, [orderId]);

    await webhook({ awb: 'AWB333', current_status: 'DELIVERED' });
    const first = await orderRow(orderId);

    // Out-of-order delivery of an earlier event.
    await webhook({ awb: 'AWB333', current_status: 'IN TRANSIT' });
    const second = await orderRow(orderId);

    assert.equal(second['state'], 'delivered');
    assert.equal(second['delivered_at'], first['delivered_at'], 'the arrival time must not move');
  });
});
