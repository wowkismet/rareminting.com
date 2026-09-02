import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Seller onboarding and the listing flow, end to end against real PostgreSQL.
 *
 * The point of these tests is that the serial engine's output actually lands in
 * the database — date readings and pattern tags included — so that Find My Date
 * is an indexed query rather than a scan.
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

// Unique per call, so a test registering two accounts does not collide on the
// email. Reset between tests clears the table, so the counter need not.
let accountCounter = 0;

async function signUp(email?: string): Promise<string> {
  accountCounter += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: {
      email: email ?? `seller${accountCounter}@example.com`,
      password: 'correct horse battery',
    },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { token: string }).token;
}

async function becomeSeller(token: string): Promise<string> {
  const res = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { seller: { id: string } }).seller.id;
}

/**
 * A seller who may actually publish.
 *
 * Most tests here are about listings rather than about onboarding, so they
 * want a seller past the approval gate.
 */
async function approvedSeller(token: string): Promise<string> {
  const id = await becomeSeller(token);
  await approveSeller(pg, id);
  return id;
}

const LISTING = {
  serial: '9AB* 150892',
  denomination: 100,
  series: 'Mahatma Gandhi New Series',
  grade: 'UNC',
  priceInr: 4500,
};

async function createListing(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return request(app, 'POST', '/v1/listings', { token, body: { ...LISTING, ...overrides } });
}

describe('seller onboarding', () => {
  it('creates a seller profile and grants the seller role', async () => {
    const token = await signUp();
    const res = await request(app, 'POST', '/v1/sellers', {
      token,
      body: sellerBody({ fullName: 'Kavya Kapoor' }),
    });
    assert.equal(res.status, 201);

    const body = (await res.json()) as {
      seller: { displayName: string; kycState: string; mintingVerified: boolean };
    };
    assert.equal(body.seller.displayName, 'Kavya Kapoor');
    assert.equal(body.seller.kycState, 'pending', 'KYC starts pending');
    assert.equal(body.seller.mintingVerified, false);

    const me = await request(app, 'GET', '/v1/auth/me', { token });
    const user = (await me.json()) as { user: { roles: string[] } };
    assert.ok(user.user.roles.includes('seller'));
  });

  it('refuses a second seller profile for the same account', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const again = await request(app, 'POST', '/v1/sellers', {
      token,
      body: sellerBody({ fullName: 'Another Person' }),
    });
    assert.equal(again.status, 409);
  });

  it('requires sign-in', async () => {
    const res = await request(app, 'POST', '/v1/sellers', {
      body: sellerBody(),
    });
    assert.equal(res.status, 401);
  });

  it('never returns the identity numbers it was given', async () => {
    const token = await signUp();
    const body = sellerBody({ fullName: 'Kavya Kapoor' });
    const res = await request(app, 'POST', '/v1/sellers', { token, body });
    assert.equal(res.status, 201);

    const text = await res.text();
    assert.equal(text.includes(String(body['aadhaar'])), false, 'Aadhaar came back in the response');
    assert.equal(text.includes(String(body['pan'])), false, 'PAN came back in the response');
    // The last four are deliberately present: support needs them.
    assert.ok(text.includes(String(body['pan']).slice(-4)));
  });

  it('stores no identity number in the clear', async () => {
    const token = await signUp();
    const body = sellerBody({ fullName: 'Kavya Kapoor' });
    await request(app, 'POST', '/v1/sellers', { token, body });

    const stored = await pg.query<{ number_hash: string; number_last4: string }>(
      `select number_hash, number_last4 from kyc_documents`,
    );
    assert.equal(stored.rows.length, 2, 'a PAN and an Aadhaar');
    for (const row of stored.rows) {
      assert.equal(row.number_hash.includes(String(body['aadhaar'])), false);
      assert.equal(row.number_hash.includes(String(body['pan'])), false);
      assert.match(row.number_hash, /^[0-9a-f]{64}$/, 'an HMAC, hex encoded');
      assert.match(row.number_last4, /^[0-9A-Z]{4}$/);
    }
  });

  it('rejects a malformed PAN, Aadhaar or mobile', async () => {
    for (const [field, value] of [
      ['pan', 'NOTAPAN123'],
      ['aadhaar', '123456789012'], // reserved leading digit, and a bad checksum
      ['mobile', '1234567890'], // not a mobile range
      ['fullName', 'K'],
    ] as const) {
      const token = await signUp();
      const res = await request(app, 'POST', '/v1/sellers', {
        token,
        body: sellerBody({ [field]: value }),
      });
      assert.equal(res.status, 400, `accepted a bad ${field}`);
    }
  });

  it('rejects a company PAN, because a person registers to sell', async () => {
    const token = await signUp();
    // The fourth character is the holder type; C is a company.
    const res = await request(app, 'POST', '/v1/sellers', {
      token,
      body: sellerBody({ pan: 'ABCCE1234F' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { details?: Record<string, string> };
    assert.equal(body.details?.['pan'], 'not_individual');
  });

  it('lets one PAN register exactly one seller', async () => {
    const shared = sellerBody({ fullName: 'Kavya Kapoor' });

    const first = await request(app, 'POST', '/v1/sellers', {
      token: await signUp(),
      body: shared,
    });
    assert.equal(first.status, 201);

    // A different account, different mobile, the same identity numbers.
    const second = await request(app, 'POST', '/v1/sellers', {
      token: await signUp(),
      body: { ...shared, mobile: '9876500001' },
    });
    assert.equal(second.status, 409, 'a PAN registered twice');
  });
});

describe('publishing waits for admin approval', () => {
  it('refuses to publish for a seller who is not yet approved', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const created = await createListing(token);
    assert.equal(created.status, 201);
    const { listing } = (await created.json()) as { listing: { id: string } };

    const res = await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
    assert.equal(res.status, 403, 'an unapproved seller published');

    // The listing is still a draft, not half-published.
    const after = await request(app, 'GET', `/v1/listings/${listing.id}`, { token });
    const body = (await after.json()) as { listing: { state: string } };
    assert.equal(body.listing.state, 'draft');
  });

  it('lets an approved seller publish, without any cap on how many', async () => {
    const token = await signUp();
    const sellerId = await becomeSeller(token);
    await approveSeller(pg, sellerId);

    // Comfortably past the old limit of ten.
    for (let i = 0; i < 12; i += 1) {
      const created = await createListing(token, {
        serial: `9AB ${String(100000 + i).padStart(6, '0')}`,
      });
      assert.equal(created.status, 201, `listing ${i} was refused`);
      const { listing } = (await created.json()) as { listing: { id: string } };

      const published = await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
      assert.equal(published.status, 200, `publish ${i} was refused`);
    }

    const live = await request(app, 'GET', '/v1/listings?limit=50');
    const body = (await live.json()) as { listings: unknown[] };
    assert.equal(body.listings.length, 12);
  });

  it('still lets an unapproved seller draft, so they can prepare', async () => {
    const token = await signUp();
    await becomeSeller(token);
    for (let i = 0; i < 3; i += 1) {
      const created = await createListing(token, {
        serial: `7CD ${String(200000 + i).padStart(6, '0')}`,
      });
      assert.equal(created.status, 201);
    }
  });
});

describe('creating a listing', () => {
  it('refuses if the account is not a seller', async () => {
    const token = await signUp();
    const res = await createListing(token);
    assert.equal(res.status, 403);
    assert.match(((await res.json()) as { message: string }).message, /Register as a seller/);
  });

  it('stores the decomposed serial', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const res = await createListing(token);
    assert.equal(res.status, 201, await res.clone().text());

    const rows = await pg.query<{
      prefix: string;
      is_star: boolean;
      serial_digits: string;
      serial_value: number;
      digit_count: number;
    }>(`select prefix, is_star, serial_digits, serial_value, digit_count from notes`);

    const note = rows.rows[0]!;
    assert.equal(note.prefix, '9AB');
    assert.equal(note.is_star, true, 'the star marker must be captured');
    assert.equal(note.serial_digits, '150892');
    assert.equal(Number(note.serial_value), 150892);
    assert.equal(note.digit_count, 6);
  });

  it('persists the date readings the engine produced', async () => {
    const token = await signUp();
    await becomeSeller(token);
    await createListing(token);

    const rows = await pg.query<{ matched_date: string; era: string; confidence: string }>(
      `select matched_date::text, era, confidence::text from date_matches order by confidence desc`,
    );
    assert.ok(rows.rows.length >= 1, 'expected at least one date reading');
    assert.equal(rows.rows[0]!.matched_date, '1992-08-15');
    assert.equal(rows.rows[0]!.era, 'modern');
  });

  it('persists pattern tags, including star series', async () => {
    const token = await signUp();
    await becomeSeller(token);
    await createListing(token);

    const rows = await pg.query<{ tag_code: string }>(
      `select tag_code from listing_pattern_tags`,
    );
    const codes = rows.rows.map((r) => r.tag_code);
    assert.ok(codes.includes('STAR_SERIES'), `expected STAR_SERIES, got ${codes.join(', ')}`);
  });

  it('records every reading of an ambiguous serial', async () => {
    const token = await signUp();
    await becomeSeller(token);
    // 010203 reads as three different dates.
    await createListing(token, { serial: '1AA 010203' });

    const rows = await pg.query<{ count: string }>(
      `select count(*)::text as count from date_matches`,
    );
    assert.ok(Number(rows.rows[0]!.count) >= 3, 'an ambiguous serial should yield several readings');
  });

  it('rejects a serial it cannot read', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const res = await createListing(token, { serial: 'HELLO' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /could not be read/);
  });

  it('rejects a non-positive price', async () => {
    const token = await signUp();
    await becomeSeller(token);
    assert.equal((await createListing(token, { priceInr: 0 })).status, 400);
    assert.equal((await createListing(token, { priceInr: -5 })).status, 400);
  });

  it('stores money as integer paise', async () => {
    const token = await signUp();
    await becomeSeller(token);
    await createListing(token, { priceInr: 4500.5 });
    const rows = await pg.query<{ price_paise: string }>(`select price_paise::text from listings`);
    assert.equal(rows.rows[0]!.price_paise, '450050');
  });

  it('starts as a draft, not visible for sale', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const res = await createListing(token);
    const body = (await res.json()) as { listing: { state: string } };
    assert.equal(body.listing.state, 'draft');
  });
});

describe('serial uniqueness', () => {
  it('refuses the same serial while one is live', async () => {
    const token = await signUp();
    await becomeSeller(token);
    assert.equal((await createListing(token)).status, 201);

    const again = await createListing(token);
    assert.equal(again.status, 409);
    assert.match(((await again.json()) as { message: string }).message, /already listed/);
  });

  it('allows the same digits on a different denomination', async () => {
    const token = await signUp();
    await becomeSeller(token);
    assert.equal((await createListing(token)).status, 201);
    assert.equal((await createListing(token, { denomination: 500 })).status, 201);
  });

  it('leaves nothing behind when creation fails', async () => {
    const token = await signUp();
    await becomeSeller(token);
    await createListing(token);
    const before = await pg.query<{ count: string }>(`select count(*)::text as count from listings`);

    await createListing(token); // conflicts

    const after = await pg.query<{ count: string }>(`select count(*)::text as count from listings`);
    assert.equal(
      after.rows[0]!.count,
      before.rows[0]!.count,
      'the failed insert must roll back the listing row too',
    );
  });
});

describe('publishing', () => {
  it('moves a draft to minted', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };

    const res = await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(((await res.json()) as { listing: { state: string } }).listing.state, 'minted');
  });

  it('refuses to publish twice', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });

    const again = await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });
    assert.equal(again.status, 409);
  });

  it("refuses to publish another seller's listing", async () => {
    const mine = await signUp('a@example.com');
    await approvedSeller(mine);
    const created = (await (await createListing(mine)).json()) as { listing: { id: string } };

    const theirs = await signUp('b@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token: theirs,
      body: sellerBody({ fullName: 'Someone Else' }),
    });

    const res = await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, {
      token: theirs,
    });
    assert.equal(res.status, 403);
  });
});

describe('find my date', () => {
  async function publishedListing(token: string, serial: string, denomination = 100): Promise<void> {
    const res = await createListing(token, { serial, denomination });
    assert.equal(res.status, 201, await res.clone().text());
    const { listing } = (await res.json()) as { listing: { id: string } };
    const pub = await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
    assert.equal(pub.status, 200);
  }

  it('finds an exact date match', async () => {
    const token = await signUp();
    await approvedSeller(token);
    await publishedListing(token, '3UT 150847');

    const res = await request(app, 'GET', '/v1/listings?date=1947-08-15');
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exact: { match: { iso: string; era: string } }[];
      dayMonth: unknown[];
    };
    assert.equal(body.exact.length, 1);
    assert.equal(body.exact[0]!.match.iso, '1947-08-15');
    assert.equal(body.exact[0]!.match.era, 'heritage');
  });

  it('separates same day-and-month in another year', async () => {
    const token = await signUp();
    await approvedSeller(token);
    await publishedListing(token, '3UT 150847');
    await publishedListing(token, '4FZ 150892', 500);

    const res = await request(app, 'GET', '/v1/listings?date=1947-08-15');
    const body = (await res.json()) as { exact: unknown[]; dayMonth: unknown[] };
    assert.equal(body.exact.length, 1, 'only 1947 is an exact match');
    assert.equal(body.dayMonth.length, 1, '1992 is a near match on the same day and month');
  });

  it('does not surface unpublished drafts', async () => {
    const token = await signUp();
    await approvedSeller(token);
    await createListing(token, { serial: '3UT 150847' }); // left as draft

    const res = await request(app, 'GET', '/v1/listings?date=1947-08-15');
    const body = (await res.json()) as { exact: unknown[]; dayMonth: unknown[] };
    assert.equal(body.exact.length + body.dayMonth.length, 0);
  });

  it('rejects a malformed date', async () => {
    assert.equal((await request(app, 'GET', '/v1/listings?date=15-08-1947')).status, 400);
  });

  it('returns an empty result rather than an error when nothing matches', async () => {
    const res = await request(app, 'GET', '/v1/listings?date=1801-03-04');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { exact: unknown[]; dayMonth: unknown[] };
    assert.deepEqual([body.exact.length, body.dayMonth.length], [0, 0]);
  });
});

describe('reading a listing', () => {
  it('returns the serial, dates and patterns together', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });

    const res = await request(app, 'GET', `/v1/listings/${created.listing.id}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      listing: {
        note: { serialDigits: string; isStar: boolean };
        dates: { iso: string | null }[];
        patterns: { code: string }[];
      };
    };
    assert.equal(body.listing.note.serialDigits, '150892');
    assert.equal(body.listing.note.isStar, true);
    assert.ok(body.listing.dates.length >= 1);
    assert.ok(body.listing.patterns.some((p) => p.code === 'STAR_SERIES'));
  });

  it('404s an unknown id', async () => {
    const res = await request(app, 'GET', '/v1/listings/00000000-0000-0000-0000-000000000000');
    assert.equal(res.status, 404);
  });

  it('404s a malformed id rather than erroring', async () => {
    assert.equal((await request(app, 'GET', '/v1/listings/not-a-uuid')).status, 404);
  });

  it('hides another seller draft from the public', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };

    const res = await request(app, 'GET', `/v1/listings/${created.listing.id}`);
    assert.equal(res.status, 404, 'a draft must not be readable by anyone else');
  });
});

describe('the listing index', () => {
  it('reports the true total, not the size of the page', async () => {
    const token = await signUp();
    await approvedSeller(token);

    for (let i = 0; i < 5; i += 1) {
      const created = await createListing(token, {
        serial: `6EF ${String(300000 + i).padStart(6, '0')}`,
      });
      const { listing } = (await created.json()) as { listing: { id: string } };
      await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });
    }

    const res = await request(app, 'GET', '/v1/listings?limit=2');
    const body = (await res.json()) as { total: number; listings: unknown[] };
    assert.equal(body.listings.length, 2, 'the page should honour the limit');
    assert.equal(body.total, 5, 'the total should count everything for sale');
  });

  it('counts only what is actually for sale', async () => {
    const token = await signUp();
    await approvedSeller(token);

    const published = await createListing(token, { serial: '6EF 400001' });
    const { listing } = (await published.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });

    // A draft is not for sale and must not be advertised as stock.
    await createListing(token, { serial: '6EF 400002' });

    const res = await request(app, 'GET', '/v1/listings');
    const body = (await res.json()) as { total: number };
    assert.equal(body.total, 1, 'a draft was counted as being for sale');
  });

  it('carries the serial, so a card can show it without a second request', async () => {
    const token = await signUp();
    await approvedSeller(token);
    const created = await createListing(token, { serial: '9AB* 150892' });
    const { listing } = (await created.json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${listing.id}/publish`, { token });

    const res = await request(app, 'GET', '/v1/listings');
    const body = (await res.json()) as {
      listings: { note?: { serialDigits: string; isStar: boolean; denomination: number } }[];
    };
    const first = body.listings[0];
    assert.equal(first?.note?.serialDigits, '150892');
    assert.equal(first?.note?.isStar, true);
    assert.equal(first?.note?.denomination, 100);
  });
});
