import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * The seller dashboard.
 *
 * The numbers here are the ones a seller makes decisions on, so the tests care
 * about them being right rather than merely present — particularly the payout,
 * which is not the same as what the buyer paid.
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

let accounts = 0;

async function signUp(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `dash${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

async function approvedSeller(token: string): Promise<string> {
  const res = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller } = (await res.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);
  return seller.id;
}

async function listing(token: string, serial: string, priceInr = 4500): Promise<string> {
  const res = await request(app, 'POST', '/v1/listings', {
    token,
    body: { serial, denomination: 100, series: 'Mahatma Gandhi New Series', priceInr },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { listing: { id: string } }).listing.id;
}

interface Dashboard {
  stats: {
    listings: { total: number; draft: number; live: number; sold: number };
    byKind: { notes: number; coins: number; other: number };
    views: number;
    sales: {
      orders: number;
      awaitingPayment: number;
      awaitingDispatch: number;
      grossInr: number;
      payoutInr: number;
      committedInr: number;
    };
    auctions: { live: number; scheduled: number };
  };
  listings: { id: string; views: number; photoCount: number; state: string }[];
}

async function dashboard(token: string): Promise<Dashboard> {
  const res = await request(app, 'GET', '/v1/sellers/me/dashboard', { token });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Dashboard;
}

describe('seller dashboard', () => {
  it('needs a seller profile', async () => {
    const token = await signUp();
    const res = await request(app, 'GET', '/v1/sellers/me/dashboard', { token });
    assert.equal(res.status, 403);
  });

  it('reports zeroes for a seller with nothing listed', async () => {
    const token = await signUp();
    await approvedSeller(token);

    const d = await dashboard(token);
    assert.equal(d.stats.listings.total, 0);
    assert.equal(d.stats.views, 0);
    assert.equal(d.stats.sales.orders, 0);
    assert.equal(d.stats.sales.payoutInr, 0);
    assert.deepEqual(d.listings, []);
  });

  it('counts listings by state', async () => {
    const token = await signUp();
    await approvedSeller(token);

    const a = await listing(token, '9AB 150892');
    await listing(token, '9AB 150893');
    await request(app, 'POST', `/v1/listings/${a}/publish`, { token });

    const d = await dashboard(token);
    assert.equal(d.stats.listings.total, 2);
    assert.equal(d.stats.listings.live, 1);
    assert.equal(d.stats.listings.draft, 1);
    assert.equal(d.stats.byKind.notes, 2);
  });

  it('shows only this seller their own numbers', async () => {
    const mine = await signUp();
    await approvedSeller(mine);
    await listing(mine, '9AB 150892');

    const theirs = await signUp();
    await approvedSeller(theirs);
    await listing(theirs, '7CD 220192');
    await listing(theirs, '7CD 220193');

    assert.equal((await dashboard(mine)).stats.listings.total, 1);
    assert.equal((await dashboard(theirs)).stats.listings.total, 2);
  });

  it('counts a view by a stranger but not by the seller', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const id = await listing(token, '9AB 150892');
    await request(app, 'POST', `/v1/listings/${id}/publish`, { token });

    // The seller looking at their own listing is not a view.
    await request(app, 'GET', `/v1/listings/${id}`, { token });
    assert.equal((await dashboard(token)).stats.views, 0, 'the seller viewed their own listing');

    // A signed-out visitor is.
    await request(app, 'GET', `/v1/listings/${id}`);
    await request(app, 'GET', `/v1/listings/${id}`);
    assert.equal((await dashboard(token)).stats.views, 2);

    const row = (await dashboard(token)).listings.find((l) => l.id === id);
    assert.equal(row?.views, 2, 'the per-listing count disagrees with the total');
  });

  it('does not count views of a draft', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const id = await listing(token, '9AB 150892');

    // Nobody but the owner can even load it, and that must not register.
    await request(app, 'GET', `/v1/listings/${id}`, { token });
    assert.equal((await dashboard(token)).stats.views, 0);
  });

  it('counts an unpaid order without claiming the money has arrived', async () => {
    const seller = await signUp();
    await approvedSeller(seller);
    const id = await listing(seller, '9AB 150892', 10000);
    await request(app, 'POST', `/v1/listings/${id}/publish`, { token: seller });

    const buyer = await signUp();
    const order = await request(app, 'POST', `/v1/listings/${id}/order`, { token: buyer });
    assert.equal(order.status, 201, await order.clone().text());

    const d = await dashboard(seller);
    assert.equal(d.stats.sales.orders, 1, 'the order should be visible');
    assert.equal(d.stats.sales.awaitingPayment, 1);
    assert.equal(d.stats.sales.committedInr, 10000, 'the buyer has committed to this much');
    // Nothing has cleared, so nothing is earned.
    assert.equal(d.stats.sales.grossInr, 0, 'unpaid money was reported as earned');
    assert.equal(d.stats.sales.payoutInr, 0);
  });

  it('reports gross and payout separately once payment clears, payout the smaller', async () => {
    const seller = await signUp();
    await approvedSeller(seller);
    const id = await listing(seller, '9AB 150892', 10000);
    await request(app, 'POST', `/v1/listings/${id}/publish`, { token: seller });

    const buyer = await signUp();
    await request(app, 'POST', `/v1/listings/${id}/order`, { token: buyer });

    // Stand in for the gateway, which is not wired up yet.
    await pg.query(`update orders set state = 'paid'`);

    const d = await dashboard(seller);
    assert.equal(d.stats.sales.grossInr, 10000, 'gross should be what the buyer paid for the item');
    assert.ok(
      d.stats.sales.payoutInr < d.stats.sales.grossInr,
      'payout must be net of commission, GST and TDS',
    );
    assert.ok(d.stats.sales.payoutInr > 0);
    assert.equal(d.stats.sales.awaitingDispatch, 1);
  });

  it('reports how many photographs each listing has', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const id = await listing(token, '9AB 150892');

    const before = (await dashboard(token)).listings.find((l) => l.id === id);
    assert.equal(before?.photoCount, 0, 'a new listing should show no photographs');
  });
});
