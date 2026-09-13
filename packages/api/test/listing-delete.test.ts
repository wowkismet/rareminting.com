import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Deleting a listing, reversibly.
 *
 * The spec asks staff to be able to delete a listing and restore it, and those
 * two are only compatible if nothing is actually destroyed. Orders reference
 * the row, so a hard delete would take somebody's purchase history with it —
 * and a collectibles marketplace has to be able to say, years later, what was
 * sold and how it was described at the time.
 *
 * What is worth testing is therefore that the row survives, that it disappears
 * from everywhere a buyer can see, and that it cannot be deleted out from
 * under somebody who is part-way through paying for it.
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

async function signUp(): Promise<{ token: string; userId: string }> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `del${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function admin(): Promise<string> {
  const { token, userId } = await signUp();
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [userId]);
  return token;
}

/** A published listing, and the token of the seller who owns it. */
async function published(serial: string): Promise<string> {
  const { token } = await signUp();
  const made = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Arjun Nair' }),
  });
  const { seller } = (await made.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  const created = await request(app, 'POST', '/v1/listings', {
    token,
    body: { serial, denomination: 100, series: 'Mahatma Gandhi New Series', priceInr: 4500 },
  });
  const { listing } = (await created.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
  return listing.id;
}

describe('deleting a listing', () => {
  it('hides it without destroying the row', async () => {
    const id = await published('9AB 610001');
    const staff = await admin();

    const res = await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });
    assert.equal(res.status, 200, await res.clone().text());

    // Still there, with a timestamp on it. Orders reference this row.
    const row = await pg.query<{ deleted_at: string | null; state: string }>(
      `select deleted_at::text as deleted_at, state::text as state from listings where id = $1`,
      [id],
    );
    assert.equal(row.rows.length, 1);
    assert.notEqual(row.rows[0]?.deleted_at, null);
    // The state says where it was in its life; deleting must not overwrite the
    // answer to "was this live when it went?".
    assert.equal(row.rows[0]?.state, 'minted');
  });

  it('disappears from the floor and from its own page', async () => {
    const id = await published('9AB 610002');
    const staff = await admin();

    const before = await request(app, 'GET', `/v1/listings/${id}`);
    assert.equal(before.status, 200);

    await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });

    assert.equal((await request(app, 'GET', `/v1/listings/${id}`)).status, 404);

    const floor = await request(app, 'GET', '/v1/listings?limit=50');
    const body = (await floor.json()) as { listings: { id: string }[]; total: number };
    assert.equal(body.listings.some((l) => l.id === id), false);
  });

  it('cannot be bought once deleted', async () => {
    const id = await published('9AB 610003');
    const staff = await admin();
    await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });

    const { token: buyer } = await signUp();
    const res = await request(app, 'POST', `/v1/listings/${id}/order`, { token: buyer });
    assert.equal(res.status, 404, await res.clone().text());
  });

  it('refuses while a buyer is part-way through paying', async () => {
    const id = await published('9AB 610004');
    await pg.query(`update listings set state = 'reserved' where id = $1`, [id]);
    const staff = await admin();

    const res = await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });
    assert.equal(res.status, 409, await res.clone().text());
  });

  it('refuses a second delete rather than pretending', async () => {
    const id = await published('9AB 610005');
    const staff = await admin();
    await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });

    const again = await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });
    assert.equal(again.status, 409);
  });

  it('is closed to everybody but staff', async () => {
    const id = await published('9AB 610006');
    const { token: nobody } = await signUp();

    assert.equal((await request(app, 'DELETE', `/v1/admin/listings/${id}`)).status, 401);
    // 404 rather than 403: the console does not confirm its own existence.
    assert.equal(
      (await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: nobody })).status,
      404,
    );
  });

  it('records the deletion against the admin who did it', async () => {
    const id = await published('9AB 610007');
    const staff = await admin();
    await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });

    const log = await pg.query<{ actor_role: string }>(
      `select actor_role::text as actor_role
         from audit_logs where entity_id = $1 and action = 'LISTING_DELETED'`,
      [id],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]?.actor_role, 'admin');
  });
});

describe('restoring a deleted listing', () => {
  it('brings it back, in the state it left in', async () => {
    const id = await published('9AB 620001');
    const staff = await admin();
    await request(app, 'DELETE', `/v1/admin/listings/${id}`, { token: staff });

    const res = await request(app, 'POST', `/v1/admin/listings/${id}/restore`, { token: staff });
    assert.equal(res.status, 200, await res.clone().text());

    assert.equal((await request(app, 'GET', `/v1/listings/${id}`)).status, 200);

    const row = await pg.query<{ deleted_at: string | null; state: string }>(
      `select deleted_at::text as deleted_at, state::text as state from listings where id = $1`,
      [id],
    );
    assert.equal(row.rows[0]?.deleted_at, null);
    assert.equal(row.rows[0]?.state, 'minted');
  });

  it('404s a listing that was never deleted', async () => {
    const id = await published('9AB 620002');
    const staff = await admin();

    const res = await request(app, 'POST', `/v1/admin/listings/${id}/restore`, { token: staff });
    assert.equal(res.status, 404);
  });
});
