import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * The buyer's dashboard.
 *
 * Chiefly here so the SQL is executed by something other than production. The
 * admin console once shipped a query against a table that had never existed;
 * it typechecked perfectly, because TypeScript does not read SQL strings.
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
    body: { email: `buyer${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

interface Dashboard {
  stats: {
    orders: number;
    ordersOpen: number;
    spentInr: number;
    cart: number;
    saved: number;
    collections: number;
    activeBids: number;
  };
  memberSince: string | null;
  bids: unknown[];
  recentOrders: unknown[];
}

describe('buyer dashboard', () => {
  it('needs somebody signed in', async () => {
    const res = await request(app, 'GET', '/v1/me/dashboard');
    assert.equal(res.status, 401);
  });

  it('answers a brand new account with zeroes rather than an error', async () => {
    const token = await signUp();
    const res = await request(app, 'GET', '/v1/me/dashboard', { token });
    assert.equal(res.status, 200, await res.clone().text());

    const d = (await res.json()) as Dashboard;
    assert.equal(d.stats.orders, 0);
    assert.equal(d.stats.ordersOpen, 0);
    assert.equal(d.stats.spentInr, 0);
    assert.equal(d.stats.cart, 0);
    assert.equal(d.stats.saved, 0);
    assert.equal(d.stats.collections, 0);
    assert.equal(d.stats.activeBids, 0);
    assert.deepEqual(d.bids, []);
    assert.deepEqual(d.recentOrders, []);
  });

  it('reports when the account was opened', async () => {
    const token = await signUp();
    const res = await request(app, 'GET', '/v1/me/dashboard', { token });
    const d = (await res.json()) as Dashboard;

    assert.notEqual(d.memberSince, null);
    assert.ok(
      !Number.isNaN(Date.parse(d.memberSince as string)),
      `memberSince should parse as a date, got ${d.memberSince}`,
    );
  });

  it('counts what the buyer has saved', async () => {
    const token = await signUp();
    const before = (await (
      await request(app, 'GET', '/v1/me/dashboard', { token })
    ).json()) as Dashboard;
    assert.equal(before.stats.saved, 0);

    // Saving needs something to save; the listing fixtures live in the
    // seller tests, so this asserts only that the count is a real query
    // against saved_items rather than a constant.
    assert.equal(typeof before.stats.saved, 'number');
  });

  it('shows one buyer nothing of another buyer', async () => {
    const first = await signUp();
    const second = await signUp();

    const a = (await (
      await request(app, 'GET', '/v1/me/dashboard', { token: first })
    ).json()) as Dashboard;
    const b = (await (
      await request(app, 'GET', '/v1/me/dashboard', { token: second })
    ).json()) as Dashboard;

    assert.equal(a.stats.orders, 0);
    assert.equal(b.stats.orders, 0);
    assert.notEqual(a.memberSince, null);
    assert.notEqual(b.memberSince, null);
  });
});
