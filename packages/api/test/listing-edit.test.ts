import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Editing a listing after it exists.
 *
 * Sellers could not change anything at all until this route: a listing was
 * written once and frozen, so a typo or a price that needed dropping meant
 * withdrawing the item and relisting it, losing its views and everybody
 * watching it.
 *
 * The tests that matter are the boundaries rather than the happy path —
 * somebody else's listing, a listing with a buyer's money behind it, and an
 * auction that people have already bid on.
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

async function seller(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `edit${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;

  const made = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Meera Iyer' }),
  });
  const { seller: s } = (await made.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);
  return token;
}

async function listing(token: string, serial: string): Promise<string> {
  const res = await request(app, 'POST', '/v1/listings', {
    token,
    body: {
      serial,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      grade: 'UNC',
      priceInr: 4500,
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { listing: { id: string } }).listing.id;
}

async function mine(serial: string): Promise<{ token: string; id: string }> {
  const token = await seller();
  return { token, id: await listing(token, serial) };
}

describe('a seller editing their own listing', () => {
  it('changes the title, description and price', async () => {
    const { token, id } = await mine('9AB 510001');

    const res = await request(app, 'PATCH', `/v1/listings/${id}`, {
      token,
      body: {
        title: 'A better title',
        description: 'Rather more about the note than was first written.',
        priceInr: 7200,
      },
    });
    assert.equal(res.status, 200, await res.clone().text());

    const body = (await res.json()) as {
      listing: { title: string; description: string; priceInr: number };
    };
    assert.equal(body.listing.title, 'A better title');
    assert.equal(body.listing.priceInr, 7200);
    assert.match(body.listing.description, /^Rather more/);
  });

  it('leaves alone the fields that were not sent', async () => {
    const { token, id } = await mine('9AB 510002');
    await request(app, 'PATCH', `/v1/listings/${id}`, {
      token,
      body: { description: 'Only the description.' },
    });

    const res = await request(app, 'GET', `/v1/listings/${id}`, { token });
    const { listing: l } = (await res.json()) as { listing: { priceInr: number } };
    // The price it was created with, untouched. An absent key means "leave
    // this alone", never "blank it".
    assert.equal(l.priceInr, 4500);
  });

  it('records a named action against the seller', async () => {
    const { token, id } = await mine('9AB 510003');
    await request(app, 'PATCH', `/v1/listings/${id}`, { token, body: { priceInr: 9100 } });

    const log = await pg.query<{ actor_role: string }>(
      `select actor_role::text as actor_role
         from audit_logs where entity_id = $1 and action = 'PRICE_CHANGED'`,
      [id],
    );
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0]?.actor_role, 'seller');
  });

  it('refuses another seller reaching for it', async () => {
    const { id } = await mine('9AB 510004');
    const other = await seller();

    const res = await request(app, 'PATCH', `/v1/listings/${id}`, {
      token: other,
      body: { priceInr: 1 },
    });
    assert.equal(res.status, 403);
  });

  it('refuses an empty edit rather than touching the row', async () => {
    const { token, id } = await mine('9AB 510005');
    const res = await request(app, 'PATCH', `/v1/listings/${id}`, { token, body: {} });
    assert.equal(res.status, 400);
  });

  it('refuses a price that is not money', async () => {
    const { token, id } = await mine('9AB 510006');
    for (const priceInr of [0, -5, 1.5, 200_000_000]) {
      const res = await request(app, 'PATCH', `/v1/listings/${id}`, { token, body: { priceInr } });
      assert.equal(res.status, 400, `expected ${priceInr} to be refused`);
    }
  });

  it('will not edit a listing reserved for a buyer', async () => {
    const { token, id } = await mine('9AB 510007');
    await pg.query(`update listings set state = 'reserved' where id = $1`, [id]);

    // Somebody is part-way through paying the price that is on it.
    const res = await request(app, 'PATCH', `/v1/listings/${id}`, {
      token,
      body: { priceInr: 100 },
    });
    assert.equal(res.status, 409, await res.clone().text());
  });
});

describe('switching between a fixed price and an auction', () => {
  it('turns a fixed-price listing into an auction', async () => {
    const { token, id } = await mine('9AB 520001');

    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'auction' },
    });
    assert.equal(res.status, 200, await res.clone().text());

    // The window and starting price are set through the auction route, which
    // already knows how to validate them; this only says the mode changed.
    const body = (await res.json()) as { needsAuctionSetup: boolean };
    assert.equal(body.needsAuctionSetup, true);

    const row = await pg.query<{ sale_mode: string }>(
      `select sale_mode::text as sale_mode from listings where id = $1`,
      [id],
    );
    assert.equal(row.rows[0]?.sale_mode, 'auction');
  });

  it('refuses a change to the mode it is already in', async () => {
    const { token, id } = await mine('9AB 520002');
    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'fixed' },
    });
    assert.equal(res.status, 400);
  });

  it('will not turn a live auction with bids into a fixed sale', async () => {
    const { token, id } = await mine('9AB 520003');
    await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'auction' },
    });
    await pg.query(
      `insert into auctions (listing_id, state, starting_paise, bid_count, starts_at, ends_at)
       values ($1, 'live', 100000, 3, now() - interval '1 hour', now() + interval '1 day')
       on conflict (listing_id) do update set state = 'live', bid_count = 3`,
      [id],
    );

    // Bids are a commitment by the people who made them.
    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'fixed' },
    });
    assert.equal(res.status, 409, await res.clone().text());
    assert.match(((await res.json()) as { message: string }).message, /bid/i);
  });

  it('stands the auction down rather than destroying it', async () => {
    const { token, id } = await mine('9AB 520004');
    await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'auction' },
    });
    await pg.query(
      `insert into auctions (listing_id, state, starting_paise, bid_count, starts_at, ends_at)
       values ($1, 'scheduled', 250000, 0, now() + interval '1 day', now() + interval '3 days')
       on conflict (listing_id) do nothing`,
      [id],
    );

    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'fixed', priceInr: 5000 },
    });
    assert.equal(res.status, 200, await res.clone().text());

    // Kept, because converting back is common and the previous configuration
    // is what the seller will want when they try again.
    const row = await pg.query<{ state: string; starting_paise: string }>(
      `select state::text as state, starting_paise::text as starting_paise
         from auctions where listing_id = $1`,
      [id],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0]?.state, 'cancelled');
    assert.equal(row.rows[0]?.starting_paise, '250000');
  });

  it('records the conversion in the audit trail', async () => {
    const { token, id } = await mine('9AB 520005');
    await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'auction' },
    });

    const log = await pg.query<{ before: unknown; after: unknown }>(
      `select before, after from audit_logs
        where entity_id = $1 and action = 'SALE_TYPE_CHANGED'`,
      [id],
    );
    assert.equal(log.rows.length, 1);
  });
});
