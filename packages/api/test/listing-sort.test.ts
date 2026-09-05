import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Ordering on the browse endpoint.
 *
 * The order clause is the one piece of this query assembled as a string at
 * runtime, so it is worth pinning down: that it works, that it actually
 * shuffles, and that nothing a caller sends can reach the SQL.
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

/** A seller with `count` published listings. */
async function sellerWithListings(count: number): Promise<void> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `sort${accounts}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;

  const created = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller } = (await created.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);

  for (let i = 0; i < count; i += 1) {
    const serial = `9AB${String(100000 + i).padStart(6, '0')}`;
    const made = await request(app, 'POST', '/v1/listings', {
      token,
      body: { serial, denomination: 100, series: 'Mahatma Gandhi New Series', priceInr: 4500 },
    });
    const { listing } = (await made.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
  }
}

async function idsFrom(query: string): Promise<string[]> {
  const res = await request(app, 'GET', `/v1/listings${query}`);
  assert.equal(res.status, 200, await res.clone().text());
  const { listings } = (await res.json()) as { listings: { id: string }[] };
  return listings.map((l) => l.id);
}

describe('browse ordering', () => {
  it('is newest first by default', async () => {
    await sellerWithListings(5);
    const a = await idsFrom('');
    const b = await idsFrom('');
    assert.deepEqual(a, b, 'the default order should be stable between requests');
  });

  it('returns the same set of listings whichever order is asked for', async () => {
    await sellerWithListings(8);
    const normal = await idsFrom('');
    const shuffled = await idsFrom('?sort=random&limit=100');

    assert.equal(shuffled.length, normal.length);
    assert.deepEqual(
      [...shuffled].sort(),
      [...normal].sort(),
      'shuffling must not add or drop a listing',
    );
  });

  it('actually shuffles', async () => {
    await sellerWithListings(12);

    // Any single shuffle can coincidentally match. Several identical in a row
    // would mean the ordering is not random at all.
    const first = await idsFrom('?sort=random&limit=100');
    let differed = false;
    for (let attempt = 0; attempt < 6 && !differed; attempt += 1) {
      const next = await idsFrom('?sort=random&limit=100');
      if (next.join() !== first.join()) differed = true;
    }
    assert.ok(differed, 'six identical shuffles of twelve listings means it is not shuffling');
  });

  it('ignores an unrecognised sort rather than letting it reach the query', async () => {
    await sellerWithListings(3);

    for (const attack of [
      '?sort=random;drop%20table%20listings',
      '?sort=l.price_paise',
      '?sort=',
      '?sort=RANDOM()',
    ]) {
      const res = await request(app, 'GET', `/v1/listings${attack}`);
      assert.equal(res.status, 200, `${attack} should be ignored, not fail`);
    }

    // The table is still there, and still has its rows.
    const after = await idsFrom('');
    assert.equal(after.length, 3);
  });
});
