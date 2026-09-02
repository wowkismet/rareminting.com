import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Coins and other collectibles.
 *
 * The point of these is that a coin has no serial number, so everything the
 * banknote path insists on has to be optional here — otherwise coins simply
 * cannot be listed, which was the state of things before.
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
  await pg.exec('truncate collectibles cascade;');
});

let accounts = 0;
async function seller(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `coin${accounts}@example.com`, password: 'correct horse battery' },
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

describe('listing a coin', () => {
  it('needs no serial number', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: {
        kind: 'coin',
        title: '1947 One Rupee',
        priceInr: 1200,
        denomination: 1,
        yearOfIssue: 1947,
        metal: 'Nickel',
        mintMark: 'B',
        weightGrams: 11.66,
        catalogueRef: 'KM#559',
        grade: 'XF',
      },
    });
    assert.equal(res.status, 201, await res.clone().text());

    const body = (await res.json()) as {
      listing: {
        id: string;
        kind: string;
        title: string;
        collectible: { yearOfIssue: number; metal: string; weightGrams: number };
      };
    };
    assert.equal(body.listing.kind, 'coin');
    assert.equal(body.listing.title, '1947 One Rupee');
    assert.equal(body.listing.collectible.yearOfIssue, 1947);
    assert.equal(body.listing.collectible.metal, 'Nickel');
    assert.equal(body.listing.collectible.weightGrams, 11.66);
  });

  it('builds a title from the details when none is given', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'coin', priceInr: 900, yearOfIssue: 1985, denomination: 2, metal: 'Copper' },
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { listing: { title: string } };
    assert.equal(body.listing.title, '1985 ₹2 Coin Copper');
  });

  it('rejects an impossible year or a negative weight', async () => {
    const token = await seller();
    for (const bad of [{ yearOfIssue: 1200 }, { yearOfIssue: 3000 }, { weightGrams: -5 }]) {
      const res = await request(app, 'POST', '/v1/listings', {
        token,
        body: { kind: 'coin', title: 'Test', priceInr: 100, ...bad },
      });
      assert.equal(res.status, 400, `accepted ${JSON.stringify(bad)}`);
    }
  });

  it('still requires a price', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'coin', title: 'No price' },
    });
    assert.equal(res.status, 400);
  });

  it('rejects a kind that is not a real item kind', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'spaceship', title: 'Nope', priceInr: 100 },
    });
    assert.equal(res.status, 400);
  });

  it('publishes and appears for sale alongside banknotes', async () => {
    const token = await seller();
    const created = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'coin', title: '1947 One Rupee', priceInr: 1200, yearOfIssue: 1947 },
    });
    const { listing } = (await created.json()) as { listing: { id: string } };

    const published = await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
    assert.equal(published.status, 200, await published.clone().text());

    const index = await request(app, 'GET', '/v1/listings');
    const body = (await index.json()) as { total: number; listings: { kind: string }[] };
    assert.equal(body.total, 1);
    assert.equal(body.listings[0]?.kind, 'coin');
  });

  it('reads back its attributes on the listing page', async () => {
    const token = await seller();
    const created = await request(app, 'POST', '/v1/listings', {
      token,
      body: {
        kind: 'coin',
        title: '1947 One Rupee',
        priceInr: 1200,
        yearOfIssue: 1947,
        mintMark: 'B',
        metal: 'Nickel',
      },
    });
    const { listing } = (await created.json()) as { listing: { id: string } };

    const read = await request(app, 'GET', `/v1/listings/${listing.id}`, { token });
    const body = (await read.json()) as {
      listing: { collectible?: { mintMark: string; yearOfIssue: number }; note?: unknown };
    };
    assert.equal(body.listing.collectible?.mintMark, 'B');
    assert.equal(body.listing.collectible?.yearOfIssue, 1947);
    assert.equal(body.listing.note, undefined, 'a coin must not carry banknote fields');
  });

  it('does not appear in a date search, which reads serials', async () => {
    const token = await seller();
    const created = await request(app, 'POST', '/v1/listings', {
      token,
      body: { kind: 'coin', title: 'A coin', priceInr: 500, yearOfIssue: 1992 },
    });
    const { listing } = (await created.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });

    const search = await request(app, 'GET', '/v1/listings?date=1992-08-15');
    const body = (await search.json()) as { exact: unknown[]; dayMonth: unknown[] };
    assert.equal(body.exact.length, 0);
    assert.equal(body.dayMonth.length, 0);
  });

  it('leaves banknotes working exactly as before when kind is omitted', async () => {
    const token = await seller();
    const res = await request(app, 'POST', '/v1/listings', {
      token,
      body: {
        serial: '9AB* 150892',
        denomination: 100,
        series: 'Mahatma Gandhi New Series',
        priceInr: 4500,
      },
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { listing: { kind: string; note?: unknown } };
    assert.equal(body.listing.kind, 'banknote');
    assert.ok(body.listing.note !== undefined);
  });
});
