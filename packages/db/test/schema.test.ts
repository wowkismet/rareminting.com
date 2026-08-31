import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createSchema } from '../src/apply.ts';

/**
 * These run against real PostgreSQL (PGlite/WASM). A passing test here means
 * the database itself rejects the bad write — not that application code
 * remembered to check.
 */

let db: PGlite;

before(async () => {
  ({ db } = await createSchema());
});

after(async () => {
  await db.close();
});

// Monotonic, so two calls with identical arguments still get distinct users.
// The resale test deliberately reuses a registry key.
let seedCounter = 0;

/** Insert a user → seller → listing → note chain and return the ids. */
async function seedListing(
  serialDigits: string,
  registryKey: string,
  state = 'minted',
): Promise<{ userId: string; sellerId: string; listingId: string }> {
  seedCounter += 1;
  const email = `seed${seedCounter}@example.com`;
  const user = await db.query<{ id: string }>(
    `insert into users (email, full_name, status) values ($1, 'Test Seller', 'active') returning id`,
    [email],
  );
  const userId = user.rows[0]!.id;

  const seller = await db.query<{ id: string }>(
    `insert into sellers (user_id, kind, display_name) values ($1, 'individual', 'Test') returning id`,
    [userId],
  );
  const sellerId = seller.rows[0]!.id;

  const listing = await db.query<{ id: string }>(
    `insert into listings (seller_id, kind, title, state, sale_mode, price_paise)
     values ($1, 'banknote', 'Test note', $2, 'fixed', 500000) returning id`,
    [sellerId, state],
  );
  const listingId = listing.rows[0]!.id;

  await db.query(
    `insert into notes (listing_id, denomination, series, serial_digits, serial_value,
                        digit_count, registry_key, is_live)
     values ($1, 100, 'Mahatma Gandhi Series', $2, $3, $4, $5, $6)`,
    [
      listingId,
      serialDigits,
      Number(serialDigits),
      serialDigits.length,
      registryKey,
      ['draft', 'pending_review', 'minted', 'reserved'].includes(state),
    ],
  );

  return { userId, sellerId, listingId };
}


async function rejects(fn: () => Promise<unknown>, match: RegExp): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, match);
  }
  assert.equal(threw, true, 'expected the database to reject this write');
}

describe('money', () => {
  it('refuses a negative amount anywhere the paise domain is used', async () => {
    const { sellerId } = await seedListing('100001', 'K|money|1');
    await rejects(
      () =>
        db.query(
          `insert into listings (seller_id, kind, title, price_paise)
           values ($1, 'banknote', 'Negative', -1)`,
          [sellerId],
        ),
      /paise|check|violates/i,
    );
  });
});

describe('serial uniqueness registry', () => {
  it('allows the same serial on different denominations', async () => {
    await seedListing('150892', 'MG|100|-|9AB|150892');
    await seedListing('150892', 'MG|500|-|9AB|150892');
    const rows = await db.query<{ count: string }>(
      `select count(*)::text as count from notes where serial_digits = '150892'`,
    );
    assert.equal(rows.rows[0]!.count, '2');
  });

  it('refuses a second live listing of the same serial', async () => {
    await seedListing('222222', 'MG|100|-|1AA|222222');
    await rejects(
      () => seedListing('222222', 'MG|100|-|1AA|222222'),
      /notes_one_live_listing|duplicate key/i,
    );
  });

  it('frees the serial once the first listing is struck', async () => {
    const { listingId } = await seedListing('333333', 'MG|100|-|2BB|333333');
    // The trigger flips notes.is_live when the listing leaves an open state.
    await db.query(`update listings set state = 'struck' where id = $1`, [listingId]);

    const live = await db.query<{ is_live: boolean }>(
      `select is_live from notes where listing_id = $1`,
      [listingId],
    );
    assert.equal(live.rows[0]!.is_live, false, 'trigger should have cleared is_live');

    // A resale is now permitted.
    await seedListing('333333', 'MG|100|-|2BB|333333');
  });
});

describe('bid ledger', () => {
  let auctionId: string;
  let bidderId: string;

  before(async () => {
    const { listingId, userId } = await seedListing('444444', 'MG|100|-|3CC|444444');
    bidderId = userId;
    const auction = await db.query<{ id: string }>(
      `insert into auctions (listing_id, starting_paise, starts_at, ends_at)
       values ($1, 100000, now(), now() + interval '1 day') returning id`,
      [listingId],
    );
    auctionId = auction.rows[0]!.id;
    await db.query(
      `insert into bids (auction_id, bidder_id, amount_paise, client_nonce)
       values ($1, $2, 150000, 'nonce-1')`,
      [auctionId, bidderId],
    );
  });

  it('is idempotent per (auction, bidder, nonce)', async () => {
    await rejects(
      () =>
        db.query(
          `insert into bids (auction_id, bidder_id, amount_paise, client_nonce)
           values ($1, $2, 160000, 'nonce-1')`,
          [auctionId, bidderId],
        ),
      /bids_idempotent|duplicate key/i,
    );
  });

  it('refuses deletion of a bid', async () => {
    await rejects(
      () => db.query(`delete from bids where auction_id = $1`, [auctionId]),
      /append-only/i,
    );
  });

  it('refuses rewriting the amount of a bid', async () => {
    await rejects(
      () => db.query(`update bids set amount_paise = 1 where auction_id = $1`, [auctionId]),
      /append-only/i,
    );
  });

  it('still allows a controlled retraction', async () => {
    await db.query(`update bids set is_retracted = true where auction_id = $1`, [auctionId]);
    const rows = await db.query<{ is_retracted: boolean }>(
      `select is_retracted from bids where auction_id = $1`,
      [auctionId],
    );
    assert.equal(rows.rows[0]!.is_retracted, true);
  });

  it('rejects a proxy ceiling below the bid itself', async () => {
    await rejects(
      () =>
        db.query(
          `insert into bids (auction_id, bidder_id, amount_paise, max_proxy_paise, client_nonce)
           values ($1, $2, 200000, 100000, 'nonce-2')`,
          [auctionId, bidderId],
        ),
      /bids_proxy_ceiling|check/i,
    );
  });
});

describe('audit log', () => {
  it('cannot be updated or deleted', async () => {
    await db.query(
      `insert into audit_logs (action, entity_type, entity_id) values ('test', 'listing', 'x')`,
    );
    await rejects(() => db.query(`update audit_logs set action = 'tamper'`), /append-only/i);
    await rejects(() => db.query(`delete from audit_logs`), /append-only/i);
  });
});

describe('format constraints', () => {
  it('rejects a malformed IFSC', async () => {
    const { sellerId } = await seedListing('555551', 'K|ifsc|1');
    await rejects(
      () =>
        db.query(
          `insert into bank_accounts (seller_id, gateway_token, account_last4, ifsc, holder_name)
           values ($1, 'tok', '1234', 'NOTANIFSC', 'A')`,
          [sellerId],
        ),
      /bank_ifsc_shape|check/i,
    );
  });

  it('accepts a valid IFSC', async () => {
    const { sellerId } = await seedListing('555552', 'K|ifsc|2');
    await db.query(
      `insert into bank_accounts (seller_id, gateway_token, account_last4, ifsc, holder_name)
       values ($1, 'tok', '1234', 'HDFC0001234', 'A')`,
      [sellerId],
    );
  });

  it('rejects a non-E.164 phone number', async () => {
    await rejects(
      () => db.query(`insert into users (email, phone_e164) values ('p@example.com', '9876543210')`),
      /users_phone_shape|check/i,
    );
  });

  it('rejects an Indian PIN code that does not start 1-9', async () => {
    const { userId } = await seedListing('555553', 'K|pin|1');
    await rejects(
      () =>
        db.query(
          `insert into addresses (user_id, recipient_name, line1, city, state, postal_code)
           values ($1, 'A', 'L1', 'C', 'S', '012345')`,
          [userId],
        ),
      /addresses_pincode_shape|check/i,
    );
  });

  it('enforces one default address per user and kind', async () => {
    const { userId } = await seedListing('555554', 'K|addr|1');
    const insert = (pin: string) =>
      db.query(
        `insert into addresses (user_id, recipient_name, line1, city, state, postal_code, is_default)
         values ($1, 'A', 'L1', 'C', 'S', $2, true)`,
        [userId, pin],
      );
    await insert('110001');
    await rejects(() => insert('400001'), /addresses_one_default|duplicate key/i);
  });
});

describe('date matches', () => {
  it('rejects a partial reading that carries a year', async () => {
    const { listingId } = await seedListing('666661', 'K|dm|1');
    await rejects(
      () =>
        db.query(
          `insert into date_matches (listing_id, day, month, year, matched_date, is_partial,
                                     orders, score, confidence)
           values ($1, 15, 8, 1992, '1992-08-15', true, '{DDMM}', 0.3, 0.3)`,
          [listingId],
        ),
      /date_match_partial_shape|check/i,
    );
  });

  it('rejects a full reading with no year', async () => {
    const { listingId } = await seedListing('666662', 'K|dm|2');
    await rejects(
      () =>
        db.query(
          `insert into date_matches (listing_id, day, month, is_partial, orders, score, confidence)
           values ($1, 15, 8, false, '{DDMMYY}', 0.9, 0.9)`,
          [listingId],
        ),
      /date_match_partial_shape|check/i,
    );
  });

  it('rejects an impossible month', async () => {
    const { listingId } = await seedListing('666663', 'K|dm|3');
    await rejects(
      () =>
        db.query(
          `insert into date_matches (listing_id, day, month, year, matched_date, is_partial,
                                     orders, score, confidence)
           values ($1, 15, 13, 1992, '1992-08-15', false, '{DDMMYY}', 0.9, 0.9)`,
          [listingId],
        ),
      /date_match_month_range|check/i,
    );
  });

  it('supports the Find My Date lookup', async () => {
    const { listingId } = await seedListing('150847', 'MG|200|-|3UT|150847');
    await db.query(
      `insert into date_matches (listing_id, day, month, year, matched_date, is_partial,
                                 orders, score, confidence, era)
       values ($1, 15, 8, 1947, '1947-08-15', false, '{DDMMYY}', 0.9, 1.0, 'heritage')`,
      [listingId],
    );

    const exact = await db.query<{ listing_id: string }>(
      `select listing_id from date_matches where matched_date = '1947-08-15'`,
    );
    assert.equal(exact.rows.length, 1);
    assert.equal(exact.rows[0]!.listing_id, listingId);

    const dayMonth = await db.query<{ count: string }>(
      `select count(*)::text as count from date_matches where month = 8 and day = 15`,
    );
    assert.ok(Number(dayMonth.rows[0]!.count) >= 1);
  });
});

describe('price bands', () => {
  it('rejects a band that is not ordered floor <= fair <= ambitious', async () => {
    const { listingId } = await seedListing('777771', 'K|pb|1');
    await rejects(
      () =>
        db.query(
          `insert into price_suggestions (listing_id, floor_paise, fair_paise, ambitious_paise,
                                          confidence, explanation, drivers, model_version, rules_version)
           values ($1, 900000, 500000, 100000, 0.8, 'x', '{}', 'v1', 1)`,
          [listingId],
        ),
      /price_band_ordered|check/i,
    );
  });
});

describe('reviews', () => {
  it('rejects a rating outside 1-5', async () => {
    const { userId, sellerId, listingId } = await seedListing('888881', 'K|rv|1');
    const order = await db.query<{ id: string }>(
      `insert into orders (order_number, buyer_id, seller_id, listing_id, subtotal_paise, total_paise)
       values ('RM-TEST-1', $1, $2, $3, 100000, 100000) returning id`,
      [userId, sellerId, listingId],
    );
    await rejects(
      () =>
        db.query(
          `insert into reviews (order_id, reviewer_id, subject_seller_id, rating)
           values ($1, $2, $3, 6)`,
          [order.rows[0]!.id, userId, sellerId],
        ),
      /reviews_rating_range|check/i,
    );
  });
});

describe('auction window', () => {
  it('rejects an auction that ends before it starts', async () => {
    const { listingId } = await seedListing('999991', 'K|aw|1');
    await rejects(
      () =>
        db.query(
          `insert into auctions (listing_id, starting_paise, starts_at, ends_at)
           values ($1, 1000, now(), now() - interval '1 hour')`,
          [listingId],
        ),
      /auctions_window_ordered|check/i,
    );
  });
});
