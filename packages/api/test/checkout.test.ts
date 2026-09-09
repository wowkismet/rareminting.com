import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { addAddress, approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Checking out a basket.
 *
 * One payment across however many sellers, and all-or-nothing reservation.
 * The second is the part worth testing hardest: every item here is one of a
 * kind, so charging for four of five and apologising for the fifth is not a
 * degraded outcome, it is an unfixable one — there is no second note to send.
 */

let pg: PGlite;
let app: App;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
});

let n = 0;

async function buyer(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `co-buy${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  // Checking out needs a delivery address, so every buyer here has one.
  await addAddress(app, token);
  return token;
}

/** An approved seller with `count` published notes. Returns their listing ids. */
async function sellerWith(count: number, price = 4500): Promise<string[]> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `co-sell${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  const reg = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    n += 1;
    const made = await request(app, 'POST', '/v1/listings', {
      token,
      body: {
        serial: `9AB${String(200000 + n).padStart(6, '0')}`,
        denomination: 100,
        series: 'Mahatma Gandhi New Series',
        priceInr: price,
      },
    });
    const { listing } = (await made.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
    ids.push(listing.id);
  }
  return ids;
}

async function addToCart(token: string, listingId: string): Promise<void> {
  const res = await request(app, 'POST', '/v1/cart', { token, body: { listingId } });
  assert.equal(res.status < 300, true, await res.clone().text());
}

interface CheckoutBody {
  group: { id: string; groupNumber: string; totalInr: number; sellers: number; items: number };
  orders: { id: string; orderNumber: string; totalInr: number }[];
}

describe('checking out a basket', () => {
  it('needs somebody signed in', async () => {
    const res = await request(app, 'POST', '/v1/cart/checkout');
    assert.equal(res.status, 401);
  });

  it('refuses an empty cart', async () => {
    const token = await buyer();
    const res = await request(app, 'POST', '/v1/cart/checkout', { token });
    assert.equal(res.status, 409);
  });

  it('takes one payment across two sellers', async () => {
    const token = await buyer();
    const a = await sellerWith(2, 5000);
    const b = await sellerWith(1, 3000);
    for (const id of [...a, ...b]) await addToCart(token, id);

    const res = await request(app, 'POST', '/v1/cart/checkout', { token });
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as CheckoutBody;

    assert.equal(body.group.items, 3, 'three notes in the basket');
    assert.equal(body.group.sellers, 2, 'two sellers, one payment');
    assert.equal(body.orders.length, 2, 'one order per seller, for one payout each');

    // The group total is what the buyer is charged, once.
    const summed = body.orders.reduce((t, o) => t + o.totalInr, 0);
    assert.equal(
      body.group.totalInr,
      summed,
      'the single charge must equal the sum of every seller’s part',
    );
  });

  it('empties the cart, so the same notes cannot be bought twice', async () => {
    const token = await buyer();
    for (const id of await sellerWith(2)) await addToCart(token, id);
    await request(app, 'POST', '/v1/cart/checkout', { token });

    const cart = await request(app, 'GET', '/v1/cart', { token });
    const { count } = (await cart.json()) as { count: number };
    assert.equal(count, 0);
  });

  it('takes every note off the market together', async () => {
    const token = await buyer();
    const ids = await sellerWith(3);
    for (const id of ids) await addToCart(token, id);
    await request(app, 'POST', '/v1/cart/checkout', { token });

    const states = await pg.query<{ state: string }>(
      `select state from listings where id = any($1::uuid[])`,
      [ids],
    );
    assert.deepEqual(
      states.rows.map((r) => r.state),
      ['reserved', 'reserved', 'reserved'],
    );
  });

  it('charges nothing and reserves nothing when one item has gone', async () => {
    const token = await buyer();
    const ids = await sellerWith(3);
    for (const id of ids) await addToCart(token, id);

    // Somebody else takes the middle one between filling the cart and paying.
    await pg.query(`update listings set state = 'struck' where id = $1`, [ids[1]]);

    const res = await request(app, 'POST', '/v1/cart/checkout', { token });
    assert.equal(res.status, 409, await res.clone().text());

    // Nothing half-built: no group, no order, no line, and the two that were
    // still available are untouched rather than stranded in reserved.
    for (const [table, label] of [
      ['order_groups', 'group'],
      ['orders', 'order'],
      ['order_items', 'line'],
    ] as const) {
      const c = await pg.query<{ n: string }>(`select count(*)::text as n from ${table}`);
      assert.equal(c.rows[0]?.n, '0', `a failed checkout must leave no ${label} behind`);
    }

    const still = await pg.query<{ state: string }>(
      `select state from listings where id = any($1::uuid[]) order by state`,
      [[ids[0], ids[2]]],
    );
    assert.deepEqual(
      still.rows.map((r) => r.state),
      ['minted', 'minted'],
      'the notes that were available must stay available',
    );
  });

  it('names what has gone, rather than saying something went wrong', async () => {
    const token = await buyer();
    const ids = await sellerWith(2);
    for (const id of ids) await addToCart(token, id);
    await pg.query(`update listings set state = 'struck' where id = $1`, [ids[0]]);

    const res = await request(app, 'POST', '/v1/cart/checkout', { token });
    const body = (await res.json()) as { message: string };
    assert.match(
      body.message,
      /no longer available/i,
      `the buyer should be told which note has gone, got: ${body.message}`,
    );
  });

  it('writes a line for every note, not one for the order', async () => {
    const token = await buyer();
    const ids = await sellerWith(3, 2500);
    for (const id of ids) await addToCart(token, id);
    const res = await request(app, 'POST', '/v1/cart/checkout', { token });
    const body = (await res.json()) as CheckoutBody;

    const lines = await pg.query<{ n: string; total: string }>(
      `select count(*)::text as n, sum(i.subtotal_paise)::text as total
         from order_items i join orders o on o.id = i.order_id
        where o.group_id = $1`,
      [body.group.id],
    );
    assert.equal(lines.rows[0]?.n, '3', 'one line per note');
    assert.equal(lines.rows[0]?.total, '750000', '3 × ₹2,500 recorded line by line');
  });
});
