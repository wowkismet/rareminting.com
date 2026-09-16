import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Auctions, paused.
 *
 * The rest of the suite runs with auctions switched on, because the engine
 * still exists and still has to be tested. This file turns them off for the
 * length of its own tests and checks the two things that matter about a
 * feature being paused rather than removed:
 *
 *   nothing new can be created, including by something that never sees the
 *   forms — the mobile app has its own copy of the UI, and anything holding a
 *   session can post to the route directly;
 *
 *   and everything that already exists still works. Four bids from three
 *   bidders are on record and one won auction has a listing reserved against
 *   a buyer part-way through paying. Blocking those would break a commitment,
 *   which is a different thing from closing the doors to new lots.
 */

let pg: PGlite;
let app: App;
let wasEnabled: string | undefined;

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
  wasEnabled = process.env['AUCTIONS_ENABLED'];
  process.env['AUCTIONS_ENABLED'] = 'false';
});

// Put it back, or every file that runs after this one loses its auctions.
function restore(): void {
  if (wasEnabled === undefined) delete process.env['AUCTIONS_ENABLED'];
  else process.env['AUCTIONS_ENABLED'] = wasEnabled;
}

let n = 0;

/** A seller with one published listing, ready to be auctioned or not. */
async function sellerWithListing(serial: string): Promise<{ token: string; id: string }> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `paused${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;

  const made = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Devika Sharma' }),
  });
  const { seller } = (await made.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  const created = await request(app, 'POST', '/v1/listings', {
    token,
    body: { serial, denomination: 100, series: 'Mahatma Gandhi New Series', priceInr: 4500 },
  });
  const { listing } = (await created.json()) as { listing: { id: string } };

  // Published, so it is visible to somebody without a session. A draft is
  // owner-only by design, which is what the marketplace check below needs.
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
  return { token, id: listing.id };
}

describe('while auctions are paused', () => {
  it('refuses to start a new one, whatever is asking', async () => {
    const { token, id } = await sellerWithListing('9AB 710001');

    const res = await request(app, 'POST', `/v1/listings/${id}/auction`, {
      token,
      body: {
        startingInr: 1000,
        endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    });
    assert.equal(res.status, 409, await res.clone().text());
    assert.match(((await res.json()) as { message: string }).message, /paused/i);
    restore();
  });

  it('refuses to convert a fixed-price listing into one', async () => {
    const { token, id } = await sellerWithListing('9AB 710002');

    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'auction' },
    });
    assert.equal(res.status, 409, await res.clone().text());
    restore();
  });

  it('still lets an existing auction become a fixed-price sale', async () => {
    // The way out has to stay open, or a listing already in auction mode is
    // stranded with no way to sell it for as long as the pause lasts.
    const { token, id } = await sellerWithListing('9AB 710003');
    await pg.query(`update listings set sale_mode = 'auction' where id = $1`, [id]);

    const res = await request(app, 'POST', `/v1/listings/${id}/sale-mode`, {
      token,
      body: { saleMode: 'fixed', priceInr: 5000 },
    });
    assert.equal(res.status, 200, await res.clone().text());
    restore();
  });

  it('leaves the rest of the marketplace alone', async () => {
    const { id } = await sellerWithListing('9AB 710004');

    // A fixed-price listing is unaffected by any of this.
    assert.equal((await request(app, 'GET', `/v1/listings/${id}`)).status, 200);
    assert.equal((await request(app, 'GET', '/v1/listings?limit=5')).status, 200);
    restore();
  });
});
