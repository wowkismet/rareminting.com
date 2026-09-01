import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createSchema } from '../src/apply.ts';

/**
 * Account deletion and erasure.
 *
 * These exist because of a real failure on the server: `audit_logs.actor_id`
 * was a foreign key with `on delete set null`, so deleting a user tried to
 * rewrite an append-only table and no account could be removed at all.
 */

let db: PGlite;

before(async () => {
  ({ db } = await createSchema());
});

after(async () => {
  await db.close();
});

async function makeUser(email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into users (email, status) values ($1, 'active') returning id`,
    [email],
  );
  return r.rows[0]!.id;
}

describe('deleting an account that has audit history', () => {
  it('succeeds, and leaves the audit record behind', async () => {
    const id = await makeUser('deletable@example.com');
    await db.query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id)
       values ($1::uuid, 'user.register', 'user', $1::text)`,
      [id],
    );

    await db.query(`delete from users where id = $1`, [id]);

    const users = await db.query<{ count: string }>(
      `select count(*)::text as count from users where id = $1`,
      [id],
    );
    assert.equal(users.rows[0]!.count, '0', 'the account should be gone');

    const audit = await db.query<{ actor_id: string }>(
      `select actor_id from audit_logs where entity_id = $1`,
      [id],
    );
    assert.equal(audit.rows.length, 1, 'the audit record must survive');
    assert.equal(
      audit.rows[0]!.actor_id,
      id,
      'and must still name who acted, rather than being nulled',
    );
  });

  it('leaves a bid on the ledger when the bidder is deleted', async () => {
    const seller = await makeUser('auction-seller@example.com');
    const bidder = await makeUser('bidder@example.com');

    const s = await db.query<{ id: string }>(
      `insert into sellers (user_id, kind, display_name) values ($1,'individual','S') returning id`,
      [seller],
    );
    const l = await db.query<{ id: string }>(
      `insert into listings (seller_id, kind, title) values ($1,'banknote','Lot') returning id`,
      [s.rows[0]!.id],
    );
    const a = await db.query<{ id: string }>(
      `insert into auctions (listing_id, starting_paise, starts_at, ends_at)
       values ($1, 1000, now(), now() + interval '1 day') returning id`,
      [l.rows[0]!.id],
    );
    await db.query(
      `insert into bids (auction_id, bidder_id, amount_paise, client_nonce)
       values ($1, $2, 5000, 'n1')`,
      [a.rows[0]!.id, bidder],
    );

    await db.query(`delete from users where id = $1`, [bidder]);

    const bids = await db.query<{ bidder_id: string }>(`select bidder_id from bids`);
    assert.equal(bids.rows.length, 1, 'the bid must remain on the ledger');
    assert.equal(bids.rows[0]!.bidder_id, bidder);
  });
});

describe('anonymise_user', () => {
  it('scrubs personal data but keeps the account and its history', async () => {
    const id = await makeUser('erase-me@example.com');
    await db.query(
      `insert into users (email, status) values ('other@example.com','active')`,
    );
    await db.query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id)
       values ($1::uuid, 'user.register', 'user', $1::text)`,
      [id],
    );
    await db.query(
      `insert into addresses (user_id, recipient_name, line1, city, state, postal_code)
       values ($1, 'A', 'L1', 'Mumbai', 'MH', '400064')`,
      [id],
    );

    await db.query(`select anonymise_user($1)`, [id]);

    const user = await db.query<{
      email: string;
      full_name: string | null;
      phone_e164: string | null;
      status: string;
    }>(`select email, full_name, phone_e164, status from users where id = $1`, [id]);

    const row = user.rows[0]!;
    assert.match(row.email, /^erased\+/, 'the address must no longer identify anyone');
    assert.ok(row.email.endsWith('@invalid'), 'and must not be deliverable');
    assert.equal(row.full_name, null);
    assert.equal(row.phone_e164, null);
    assert.equal(row.status, 'closed');

    const addresses = await db.query<{ count: string }>(
      `select count(*)::text as count from addresses where user_id = $1`,
      [id],
    );
    assert.equal(addresses.rows[0]!.count, '0', 'the postal address must be removed');

    const audit = await db.query<{ count: string }>(
      `select count(*)::text as count from audit_logs where entity_id = $1`,
      [id],
    );
    assert.equal(audit.rows[0]!.count, '1', 'the audit trail must remain');
  });
});
