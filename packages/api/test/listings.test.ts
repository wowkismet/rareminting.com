import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
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

async function signUp(email = 'seller@example.com'): Promise<string> {
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email, password: 'correct horse battery' },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { token: string }).token;
}

async function becomeSeller(token: string): Promise<string> {
  const res = await request(app, 'POST', '/v1/sellers', {
    token,
    body: { kind: 'individual', displayName: 'Kapoor Numismatics' },
  });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { seller: { id: string } }).seller.id;
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
      body: { kind: 'individual', displayName: 'Kapoor Numismatics' },
    });
    assert.equal(res.status, 201);

    const body = (await res.json()) as {
      seller: { displayName: string; kycState: string; mintingVerified: boolean };
    };
    assert.equal(body.seller.displayName, 'Kapoor Numismatics');
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
      body: { kind: 'company', displayName: 'Another' },
    });
    assert.equal(again.status, 409);
  });

  it('requires sign-in', async () => {
    const res = await request(app, 'POST', '/v1/sellers', {
      body: { kind: 'individual', displayName: 'Nope' },
    });
    assert.equal(res.status, 401);
  });

  it('rejects an unknown seller kind', async () => {
    const token = await signUp();
    const res = await request(app, 'POST', '/v1/sellers', {
      token,
      body: { kind: 'wizard', displayName: 'Nope' },
    });
    assert.equal(res.status, 400);
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
    await becomeSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };

    const res = await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(((await res.json()) as { listing: { state: string } }).listing.state, 'minted');
  });

  it('refuses to publish twice', async () => {
    const token = await signUp();
    await becomeSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };
    await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });

    const again = await request(app, 'POST', `/v1/listings/${created.listing.id}/publish`, { token });
    assert.equal(again.status, 409);
  });

  it("refuses to publish another seller's listing", async () => {
    const mine = await signUp('a@example.com');
    await becomeSeller(mine);
    const created = (await (await createListing(mine)).json()) as { listing: { id: string } };

    const theirs = await signUp('b@example.com');
    await request(app, 'POST', '/v1/sellers', {
      token: theirs,
      body: { kind: 'individual', displayName: 'Someone Else' },
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
    await becomeSeller(token);
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
    await becomeSeller(token);
    await publishedListing(token, '3UT 150847');
    await publishedListing(token, '4FZ 150892', 500);

    const res = await request(app, 'GET', '/v1/listings?date=1947-08-15');
    const body = (await res.json()) as { exact: unknown[]; dayMonth: unknown[] };
    assert.equal(body.exact.length, 1, 'only 1947 is an exact match');
    assert.equal(body.dayMonth.length, 1, '1992 is a near match on the same day and month');
  });

  it('does not surface unpublished drafts', async () => {
    const token = await signUp();
    await becomeSeller(token);
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
    await becomeSeller(token);
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
    await becomeSeller(token);
    const created = (await (await createListing(token)).json()) as { listing: { id: string } };

    const res = await request(app, 'GET', `/v1/listings/${created.listing.id}`);
    assert.equal(res.status, 404, 'a draft must not be readable by anyone else');
  });
});
