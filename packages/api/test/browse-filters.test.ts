import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Filtering the floor by kind, and searching it by text.
 *
 * Both feed the category navigation and the search box in the header, so a
 * wrong answer here is a menu item that leads somewhere misleading rather than
 * an error anybody would notice.
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
    body: { email: `bf${n}@example.com`, password: 'correct horse battery' },
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

async function publishNote(token: string, serial: string): Promise<void> {
  const made = await request(app, 'POST', '/v1/listings', {
    token,
    body: { serial, denomination: 100, series: 'Mahatma Gandhi New Series', priceInr: 4500 },
  });
  const { listing } = (await made.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
}

async function publishThing(token: string, kind: string, title: string): Promise<void> {
  const made = await request(app, 'POST', '/v1/listings', {
    token,
    body: { kind, title, priceInr: 9000 },
  });
  const { listing } = (await made.json()) as { listing: { id: string } };
  await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
}

interface Page {
  total: number;
  listings: { kind?: string; title: string; note?: { serialDigits: string } }[];
}

async function browse(query: string): Promise<Page> {
  const res = await request(app, 'GET', `/v1/listings${query}`);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as Page;
}

describe('browsing by kind and text', () => {
  it('returns only the kind asked for', async () => {
    const token = await seller();
    await publishNote(token, '9AB150892');
    await publishThing(token, 'coin', 'Victoria silver rupee');
    await publishThing(token, 'jewellery', 'Gold bangle');

    const coins = await browse('?kind=coin');
    assert.equal(coins.listings.length, 1);
    assert.equal(coins.listings[0]?.title, 'Victoria silver rupee');

    const jewellery = await browse('?kind=jewellery');
    assert.equal(jewellery.listings.length, 1);
    assert.equal(jewellery.listings[0]?.title, 'Gold bangle');
  });

  it('counts under the same filter it is showing', async () => {
    const token = await seller();
    await publishNote(token, '9AB150892');
    await publishNote(token, '9AB150893');
    await publishThing(token, 'coin', 'Victoria silver rupee');

    const all = await browse('');
    assert.equal(all.total, 3, 'everything on the floor');

    const coins = await browse('?kind=coin');
    assert.equal(coins.total, 1, 'a count that ignored the filter would say 3');
  });

  it('rejects a kind that is not a kind, rather than matching nothing', async () => {
    const res = await request(app, 'GET', '/v1/listings?kind=spacecraft');
    assert.equal(res.status, 400, 'an unknown kind should say so, not return an empty floor');
  });

  it('finds a note by part of its serial', async () => {
    const token = await seller();
    await publishNote(token, '9AB150892');
    await publishNote(token, '9AB777777');

    const found = await browse('?q=7777');
    assert.equal(found.listings.length, 1);
    assert.equal(found.listings[0]?.note?.serialDigits, '777777');
  });

  it('finds a thing by part of its title, ignoring case', async () => {
    const token = await seller();
    await publishThing(token, 'jewellery', 'Victorian gold bangle');
    await publishThing(token, 'coin', 'Silver rupee');

    const found = await browse('?q=VICTORIAN');
    assert.equal(found.listings.length, 1);
    assert.equal(found.listings[0]?.title, 'Victorian gold bangle');
  });

  it('combines a kind with a search', async () => {
    const token = await seller();
    await publishThing(token, 'coin', 'Gold mohur');
    await publishThing(token, 'jewellery', 'Gold bangle');

    const found = await browse('?kind=coin&q=gold');
    assert.equal(found.listings.length, 1, 'both match "gold"; only one is a coin');
    assert.equal(found.listings[0]?.title, 'Gold mohur');
  });

  it('treats an empty search as no search', async () => {
    const token = await seller();
    await publishNote(token, '9AB150892');

    const blank = await browse('?q=');
    const spaces = await browse('?q=%20%20');
    assert.equal(blank.total, 1, 'an empty box should not empty the floor');
    assert.equal(spaces.total, 1, 'nor should a box of spaces');
  });

  it('does not let a search term reach the query', async () => {
    const token = await seller();
    await publishNote(token, '9AB150892');

    for (const attack of ["%'; drop table listings; --", '100%', '_____']) {
      const res = await request(app, 'GET', `/v1/listings?q=${encodeURIComponent(attack)}`);
      assert.equal(res.status, 200, `${attack} should be searched for, not executed`);
    }
    const after = await browse('');
    assert.equal(after.total, 1, 'the floor is still standing');
  });
});
