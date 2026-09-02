import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Buying.
 *
 * The cases that matter are the ones where money or ownership could go wrong:
 * two buyers racing for the same note, a seller buying from themselves, and
 * whether a buyer can see what the platform deducts from the seller.
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
  // reset() truncates seeded reference data, so put the rates back.
  await pg.exec(`
    insert into commission_rules
      (category_id, seller_kind, take_rate_bps, listing_fee_paise,
       buyer_premium_bps, gst_rate_bps, tds_rate_bps)
    values (null, null, 2000, 0, 0, 1800, 100)
    on conflict do nothing;
  `);
});

async function account(email: string): Promise<string> {
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

async function publishedListing(
  token: string,
  serial: string,
  priceInr = 4500,
): Promise<string> {
  const registered = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  }).catch(() => undefined);

  // Nothing reaches a buyer until an admin approves the seller, so these
  // tests — which are about buying, not onboarding — approve up front.
  if (registered !== undefined && registered.status === 201) {
    const { seller } = (await registered.json()) as { seller: { id: string } };
    await approveSeller(pg, seller.id);
  }

  const created = await request(app, 'POST', '/v1/listings', {
    token,
    body: {
      serial,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr,
    },
  });
  const id = ((await created.json()) as { listing: { id: string } }).listing.id;
  await request(app, 'POST', `/v1/listings/${id}/publish`, { token });
  return id;
}

describe('buying at the asking price', () => {
  it('creates an order and reserves the note', async () => {
    const seller = await account('s@example.com');
    const listingId = await publishedListing(seller, '9AB 150892');
    const buyer = await account('b@example.com');

    const res = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });
    assert.equal(res.status, 201, await res.clone().text());

    const body = (await res.json()) as {
      order: { orderNumber: string; state: string; totalInr: number };
    };
    assert.match(body.order.orderNumber, /^RM-/);
    assert.equal(body.order.state, 'payment_pending');
    assert.equal(body.order.totalInr, 4500);

    const listing = await pg.query<{ state: string }>(`select state from listings where id = $1`, [
      listingId,
    ]);
    assert.equal(listing.rows[0]!.state, 'reserved', 'the note must be taken off the market');
  });

  it('stores the full money breakdown on the order', async () => {
    const seller = await account('s2@example.com');
    const listingId = await publishedListing(seller, '9AB 150893');
    const buyer = await account('b2@example.com');
    await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });

    const row = await pg.query<Record<string, string>>(
      `select subtotal_paise::text, commission_paise::text,
              gst_on_commission_paise::text, tds_paise::text, total_paise::text
         from orders`,
    );
    const o = row.rows[0]!;
    assert.equal(o['subtotal_paise'], '450000');
    assert.equal(o['commission_paise'], '90000', '20%');
    assert.equal(o['gst_on_commission_paise'], '16200', '18% of the commission');
    assert.equal(o['tds_paise'], '4500', '1% of the seller gross');
    assert.equal(o['total_paise'], '450000', 'the buyer pays the asking price');
  });

  it('refuses a second buyer once the note is reserved', async () => {
    const seller = await account('s3@example.com');
    const listingId = await publishedListing(seller, '9AB 150894');

    const first = await account('b3a@example.com');
    const second = await account('b3b@example.com');

    assert.equal((await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: first })).status, 201);

    const race = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: second });
    assert.equal(race.status, 409);
    assert.match(((await race.json()) as { message: string }).message, /already been sold/);

    const orders = await pg.query<{ count: string }>(`select count(*)::text as count from orders`);
    assert.equal(orders.rows[0]!.count, '1', 'the losing order must not exist');
  });

  it('refuses a seller buying their own note', async () => {
    const seller = await account('s4@example.com');
    const listingId = await publishedListing(seller, '9AB 150895');

    const res = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: seller });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /your own listing/);
  });

  it('refuses an unpublished listing', async () => {
    const seller = await account('s5@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token: seller,
      body: sellerBody({ fullName: 'Sunil Kapoor' }),
    });
    const created = await request(app, 'POST', '/v1/listings', {
      token: seller,
      body: { serial: '9AB 150896', denomination: 100, series: 'MG', priceInr: 100 },
    });
    const id = ((await created.json()) as { listing: { id: string } }).listing.id;

    const buyer = await account('b5@example.com');
    assert.equal((await request(app, 'POST', `/v1/listings/${id}/order`, { token: buyer })).status, 409);
  });

  it('requires signing in', async () => {
    const seller = await account('s6@example.com');
    const listingId = await publishedListing(seller, '9AB 150897');
    assert.equal((await request(app, 'POST', `/v1/listings/${listingId}/order`)).status, 401);
  });
});

describe('reading an order', () => {
  it('shows the seller their deductions', async () => {
    const seller = await account('s7@example.com');
    const listingId = await publishedListing(seller, '9AB 150898');
    const buyer = await account('b7@example.com');
    const created = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });
    const orderId = ((await created.json()) as { order: { id: string } }).order.id;

    const res = await request(app, 'GET', `/v1/orders/${orderId}`, { token: seller });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { order: { payoutInr?: number; commissionInr?: number } };
    assert.equal(body.order.commissionInr, 900, '20% of the sale price');
    assert.equal(body.order.payoutInr, 4500 - 900 - 162 - 45);
  });

  it('does not show the buyer what the platform takes from the seller', async () => {
    const seller = await account('s8@example.com');
    const listingId = await publishedListing(seller, '9AB 150899');
    const buyer = await account('b8@example.com');
    const created = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });
    const orderId = ((await created.json()) as { order: { id: string } }).order.id;

    const res = await request(app, 'GET', `/v1/orders/${orderId}`, { token: buyer });
    const body = (await res.json()) as { order: Record<string, unknown> };
    assert.equal(body.order['commissionInr'], undefined);
    assert.equal(body.order['payoutInr'], undefined);
    assert.equal(body.order['totalInr'], 4500, 'the buyer still sees what they paid');
  });

  it('404s an order the caller is not party to', async () => {
    const seller = await account('s9@example.com');
    const listingId = await publishedListing(seller, '9AB 150900');
    const buyer = await account('b9@example.com');
    const created = await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });
    const orderId = ((await created.json()) as { order: { id: string } }).order.id;

    const nosy = await account('nosy@example.com');
    const res = await request(app, 'GET', `/v1/orders/${orderId}`, { token: nosy });
    assert.equal(res.status, 404, 'a stranger must not learn the order exists');
  });

  it('lists orders for both sides', async () => {
    const seller = await account('s10@example.com');
    const listingId = await publishedListing(seller, '9AB 150901');
    const buyer = await account('b10@example.com');
    await request(app, 'POST', `/v1/listings/${listingId}/order`, { token: buyer });

    const asBuyer = (await (await request(app, 'GET', '/v1/orders', { token: buyer })).json()) as {
      orders: { role: string }[];
    };
    const asSeller = (await (await request(app, 'GET', '/v1/orders', { token: seller })).json()) as {
      orders: { role: string }[];
    };
    assert.equal(asBuyer.orders[0]!.role, 'buyer');
    assert.equal(asSeller.orders[0]!.role, 'seller');
  });
});

describe('offers', () => {
  it('accepts an offer below the asking price', async () => {
    const seller = await account('o1s@example.com');
    const listingId = await publishedListing(seller, '9AB 150902');
    const buyer = await account('o1b@example.com');

    const res = await request(app, 'POST', `/v1/listings/${listingId}/offers`, {
      token: buyer,
      body: { amountInr: 3800, message: 'Would you take this?' },
    });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as { offer: { amountInr: number } }).offer.amountInr, 3800);
  });

  it('refuses an offer at or above the asking price', async () => {
    const seller = await account('o2s@example.com');
    const listingId = await publishedListing(seller, '9AB 150903');
    const buyer = await account('o2b@example.com');

    const res = await request(app, 'POST', `/v1/listings/${listingId}/offers`, {
      token: buyer,
      body: { amountInr: 4500 },
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /buy it directly/);
  });

  it('lets the seller accept, once', async () => {
    const seller = await account('o3s@example.com');
    const listingId = await publishedListing(seller, '9AB 150904');
    const buyer = await account('o3b@example.com');
    const made = await request(app, 'POST', `/v1/listings/${listingId}/offers`, {
      token: buyer,
      body: { amountInr: 3800 },
    });
    const offerId = ((await made.json()) as { offer: { id: string } }).offer.id;

    const first = await request(app, 'POST', `/v1/offers/${offerId}/respond`, {
      token: seller,
      body: { decision: 'accepted' },
    });
    assert.equal(first.status, 200);

    const again = await request(app, 'POST', `/v1/offers/${offerId}/respond`, {
      token: seller,
      body: { decision: 'declined' },
    });
    assert.equal(again.status, 409, 'a decided offer cannot be decided again');
  });

  it('does not let the buyer accept their own offer', async () => {
    const seller = await account('o4s@example.com');
    const listingId = await publishedListing(seller, '9AB 150905');
    const buyer = await account('o4b@example.com');
    const made = await request(app, 'POST', `/v1/listings/${listingId}/offers`, {
      token: buyer,
      body: { amountInr: 3800 },
    });
    const offerId = ((await made.json()) as { offer: { id: string } }).offer.id;

    const res = await request(app, 'POST', `/v1/offers/${offerId}/respond`, {
      token: buyer,
      body: { decision: 'accepted' },
    });
    assert.equal(res.status, 403);
  });

  it('refuses an offer on your own listing', async () => {
    const seller = await account('o5s@example.com');
    const listingId = await publishedListing(seller, '9AB 150906');
    const res = await request(app, 'POST', `/v1/listings/${listingId}/offers`, {
      token: seller,
      body: { amountInr: 100 },
    });
    assert.equal(res.status, 400);
  });
});
