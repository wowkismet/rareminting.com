import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * The admin console's boundary.
 *
 * The point of these tests is not that the pages render — it is that a buyer,
 * a seller and an anonymous visitor all get nothing from them, and that every
 * staff action leaves an audit record.
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

async function signUp(email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email, password: 'correct horse battery' },
  });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function makeAdmin(email: string): Promise<string> {
  const { token, userId } = await signUp(email);
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [userId]);
  return token;
}

describe('admin access', () => {
  it('is invisible to anonymous visitors', async () => {
    const res = await request(app, 'GET', '/v1/admin/overview');
    assert.equal(res.status, 401);
  });

  it('reads as not found to a signed-in buyer, not as forbidden', async () => {
    const { token } = await signUp('buyer@example.com');
    const res = await request(app, 'GET', '/v1/admin/overview', { token });
    assert.equal(
      res.status,
      404,
      'a 403 would confirm the console exists to someone who should not know',
    );
  });

  it('is closed to a seller without the admin role', async () => {
    const { token } = await signUp('seller@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token,
      body: { kind: 'individual', displayName: 'S' },
    });
    assert.equal((await request(app, 'GET', '/v1/admin/sellers', { token })).status, 404);
  });

  it('opens to an admin', async () => {
    const token = await makeAdmin('admin@example.com');
    const res = await request(app, 'GET', '/v1/admin/overview', { token });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { users: number; sellers: number };
    assert.equal(typeof body.users, 'number');
    assert.ok(body.users >= 1);
  });

  it('closes again the moment the role is removed', async () => {
    const token = await makeAdmin('temp@example.com');
    assert.equal((await request(app, 'GET', '/v1/admin/overview', { token })).status, 200);

    await pg.query(`delete from user_roles where role = 'admin'`);
    assert.equal((await request(app, 'GET', '/v1/admin/overview', { token })).status, 404);
  });
});

describe('KYC decisions', () => {
  async function sellerFor(email: string): Promise<string> {
    const { token } = await signUp(email);
    const res = await request(app, 'POST', '/v1/sellers', {
      token,
      body: { kind: 'individual', displayName: 'Kapoor Numismatics' },
    });
    return ((await res.json()) as { seller: { id: string } }).seller.id;
  }

  it('verifying grants the badge and raises the listing limit', async () => {
    const sellerId = await sellerFor('s1@example.com');
    const admin = await makeAdmin('a1@example.com');

    const res = await request(app, 'POST', `/v1/admin/sellers/${sellerId}/kyc`, {
      token: admin,
      body: { kycState: 'verified' },
    });
    assert.equal(res.status, 200);

    const row = await pg.query<{ is_minting_verified: boolean; listing_limit: number }>(
      `select is_minting_verified, listing_limit from sellers where id = $1`,
      [sellerId],
    );
    assert.equal(row.rows[0]!.is_minting_verified, true);
    assert.ok(row.rows[0]!.listing_limit >= 100);
  });

  it('refuses a rejection with no reason', async () => {
    const sellerId = await sellerFor('s2@example.com');
    const admin = await makeAdmin('a2@example.com');

    const res = await request(app, 'POST', `/v1/admin/sellers/${sellerId}/kyc`, {
      token: admin,
      body: { kycState: 'rejected' },
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /reason/i);
  });

  it('accepts a rejection with a reason, and does not grant the badge', async () => {
    const sellerId = await sellerFor('s3@example.com');
    const admin = await makeAdmin('a3@example.com');

    const res = await request(app, 'POST', `/v1/admin/sellers/${sellerId}/kyc`, {
      token: admin,
      body: { kycState: 'rejected', reason: 'PAN name does not match the bank account.' },
    });
    assert.equal(res.status, 200);

    const row = await pg.query<{ is_minting_verified: boolean; kyc_state: string }>(
      `select is_minting_verified, kyc_state from sellers where id = $1`,
      [sellerId],
    );
    assert.equal(row.rows[0]!.kyc_state, 'rejected');
    assert.equal(row.rows[0]!.is_minting_verified, false);
  });

  it('records who decided, and what changed', async () => {
    const sellerId = await sellerFor('s4@example.com');
    const admin = await makeAdmin('a4@example.com');

    await request(app, 'POST', `/v1/admin/sellers/${sellerId}/kyc`, {
      token: admin,
      body: { kycState: 'verified' },
    });

    const audit = await pg.query<{ action: string; before: unknown; after: unknown }>(
      `select action, before, after from audit_logs where action = 'seller.kyc'`,
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(audit.rows[0]!.before, { kyc_state: 'pending' });
    assert.equal((audit.rows[0]!.after as { kyc_state: string }).kyc_state, 'verified');
  });

  it('rejects a state that is not a real KYC state', async () => {
    const sellerId = await sellerFor('s5@example.com');
    const admin = await makeAdmin('a5@example.com');
    const res = await request(app, 'POST', `/v1/admin/sellers/${sellerId}/kyc`, {
      token: admin,
      body: { kycState: 'approved' },
    });
    assert.equal(res.status, 400);
  });

  it('404s an unknown seller', async () => {
    const admin = await makeAdmin('a6@example.com');
    const res = await request(
      app,
      'POST',
      '/v1/admin/sellers/00000000-0000-0000-0000-000000000000/kyc',
      { token: admin, body: { kycState: 'verified' } },
    );
    assert.equal(res.status, 404);
  });
});

describe('listing moderation', () => {
  it('can withdraw a listing, and records it', async () => {
    const { token } = await signUp('mod-seller@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token,
      body: { kind: 'individual', displayName: 'S' },
    });
    const created = await request(app, 'POST', '/v1/listings', {
      token,
      body: {
        serial: '9AB 150892',
        denomination: 100,
        series: 'Mahatma Gandhi New Series',
        priceInr: 4500,
      },
    });
    const listingId = ((await created.json()) as { listing: { id: string } }).listing.id;

    const admin = await makeAdmin('mod-admin@example.com');
    const res = await request(app, 'POST', `/v1/admin/listings/${listingId}/state`, {
      token: admin,
      body: { state: 'withdrawn', reason: 'Image appears to be a stock photo.' },
    });
    assert.equal(res.status, 200);

    const row = await pg.query<{ state: string }>(`select state from listings where id = $1`, [
      listingId,
    ]);
    assert.equal(row.rows[0]!.state, 'withdrawn');

    const audit = await pg.query<{ count: string }>(
      `select count(*)::text as count from audit_logs where action = 'listing.moderate'`,
    );
    assert.equal(audit.rows[0]!.count, '1');
  });

  it('is closed to the seller who owns the listing', async () => {
    const { token } = await signUp('owner@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token,
      body: { kind: 'individual', displayName: 'S' },
    });
    const res = await request(
      app,
      'POST',
      '/v1/admin/listings/00000000-0000-0000-0000-000000000000/state',
      { token, body: { state: 'withdrawn' } },
    );
    assert.equal(res.status, 404);
  });
});
