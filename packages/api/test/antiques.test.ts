import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Jewellery, precious stones and antiques.
 *
 * These share the collectibles path with coins and stamps: no serial number,
 * and the fields that matter are metal, weight and year. The point of these
 * tests is that the three new item kinds survive the round trip — the enum
 * value exists in the database, the route accepts it, and it comes back out
 * again — since an enum added by migration is exactly the sort of thing that
 * typechecks perfectly and fails on the first real insert.
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

async function seller(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `antique${accounts}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  const reg = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller: s } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);
  return token;
}

const CASES = [
  {
    kind: 'jewellery',
    title: 'Victorian gold bangle',
    metal: '22ct gold',
    weightGrams: 18.4,
    yearOfIssue: 1890,
  },
  {
    kind: 'precious_stone',
    title: 'Unmounted Ceylon sapphire',
    metal: null,
    weightGrams: 2.15,
    yearOfIssue: null,
  },
  {
    kind: 'antique',
    title: 'Brass temple lamp',
    metal: 'Brass',
    weightGrams: 640,
    yearOfIssue: 1910,
  },
] as const;

describe('listing jewellery, stones and antiques', () => {
  for (const c of CASES) {
    it(`accepts a ${c.kind} without a serial number`, async () => {
      const token = await seller();
      const res = await request(app, 'POST', '/v1/listings', {
        token,
        body: {
          kind: c.kind,
          title: c.title,
          priceInr: 25000,
          ...(c.metal === null ? {} : { metal: c.metal }),
          ...(c.yearOfIssue === null ? {} : { yearOfIssue: c.yearOfIssue }),
          weightGrams: c.weightGrams,
          grade: 'VF',
        },
      });
      assert.equal(res.status, 201, await res.clone().text());

      const { listing } = (await res.json()) as { listing: { id: string; kind: string } };
      assert.equal(listing.kind, c.kind, 'the kind should survive the round trip');

      // And it must be readable back, not merely accepted.
      const fetched = await request(app, 'GET', `/v1/listings/${listing.id}`, { token });
      assert.equal(fetched.status, 200);
      const body = (await fetched.json()) as { listing: { kind: string; title: string } };
      assert.equal(body.listing.kind, c.kind);
      assert.equal(body.listing.title, c.title);
    });
  }

  it('still refuses a kind that is not a kind', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'spacecraft', title: 'Apollo 11', priceInr: 100 },
    });
    assert.equal(res.status, 400, 'an unknown kind should be rejected, not stored');
  });

  it('does not ask a stone for a mint mark', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'precious_stone', title: 'Loose emerald', priceInr: 40000 },
    });
    assert.equal(res.status, 201, await res.clone().text());
  });
});
