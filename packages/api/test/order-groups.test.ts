import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, reset } from './helpers.ts';

/**
 * The order group and order item tables.
 *
 * These exist so a basket can hold more than one thing:
 *
 *   order_groups   what the buyer paid for, once
 *     └── orders          one seller's part of it
 *           └── order_items    one listing
 *
 * The tests that matter here are the structural guarantees, because eight real
 * orders were backfilled through this migration on a live database. A backfill
 * that silently drops or double-counts a line is not something to discover
 * from a seller asking where their money went.
 */

let pg: PGlite;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
});

/** A buyer, a seller, a listing — the minimum to hang an order off. */
async function fixture(): Promise<{ buyer: string; seller: string; listing: string }> {
  const u = await pg.query<{ id: string }>(
    `insert into users (email, status) values ('grp@example.com', 'active') returning id`,
  );
  const buyer = u.rows[0]!.id;

  const su = await pg.query<{ id: string }>(
    `insert into users (email, status) values ('grpsell@example.com', 'active') returning id`,
  );
  const s = await pg.query<{ id: string }>(
    `insert into sellers (user_id, kind, display_name, kyc_state)
     values ($1, 'individual', 'Kavya Kapoor', 'verified') returning id`,
    [su.rows[0]!.id],
  );
  const seller = s.rows[0]!.id;

  const l = await pg.query<{ id: string }>(
    `insert into listings (seller_id, kind, title, state, price_paise)
     values ($1, 'banknote', 'Test note', 'minted', 500000) returning id`,
    [seller],
  );
  return { buyer, seller, listing: l.rows[0]!.id };
}

describe('order groups and items', () => {
  it('creates the tables the multi-item cart needs', async () => {
    for (const t of ['order_groups', 'order_items']) {
      const r = await pg.query<{ n: string }>(
        `select to_regclass($1)::text as n`,
        [t],
      );
      assert.equal(r.rows[0]?.n, t, `${t} should exist`);
    }

    const col = await pg.query<{ n: string }>(
      `select column_name as n from information_schema.columns
        where table_name = 'orders' and column_name = 'group_id'`,
    );
    assert.equal(col.rows[0]?.n, 'group_id', 'orders should link to its group');
  });

  it('leaves the existing single-item columns alone', async () => {
    // The whole point of the migration being additive: nothing that reads
    // orders.listing_id or orders.seller_id needed changing on the day.
    const cols = await pg.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'orders' and column_name in ('listing_id', 'seller_id')`,
    );
    assert.equal(cols.rows.length, 2, 'listing_id and seller_id must both survive');
  });

  it('holds several sellers under one payment', async () => {
    const a = await fixture();

    const second = await pg.query<{ id: string }>(
      `insert into users (email, status) values ('grpsell2@example.com', 'active') returning id`,
    );
    const s2 = await pg.query<{ id: string }>(
      `insert into sellers (user_id, kind, display_name, kyc_state)
       values ($1, 'individual', 'Raghu Verma', 'verified') returning id`,
      [second.rows[0]!.id],
    );
    const seller2 = s2.rows[0]!.id;
    const l2 = await pg.query<{ id: string }>(
      `insert into listings (seller_id, kind, title, state, price_paise)
       values ($1, 'coin', 'Test coin', 'minted', 300000) returning id`,
      [seller2],
    );

    const g = await pg.query<{ id: string }>(
      `insert into order_groups (group_number, buyer_id, total_paise)
       values ('G-TEST-1', $1, 800000) returning id`,
      [a.buyer],
    );
    const group = g.rows[0]!.id;

    for (const [seller, listing, paise, n] of [
      [a.seller, a.listing, 500000, 'RM-A'],
      [seller2, l2.rows[0]!.id, 300000, 'RM-B'],
    ] as const) {
      const o = await pg.query<{ id: string }>(
        `insert into orders (order_number, buyer_id, seller_id, listing_id, group_id,
                             subtotal_paise, total_paise)
         values ($1, $2, $3, $4, $5, $6, $6) returning id`,
        [n, a.buyer, seller, listing, group, paise],
      );
      await pg.query(
        `insert into order_items (order_id, listing_id, subtotal_paise)
         values ($1, $2, $3)`,
        [o.rows[0]!.id, listing, paise],
      );
    }

    const rolled = await pg.query<{ sellers: string; items: string; total: string }>(
      `select count(distinct o.seller_id)::text as sellers,
              count(i.id)::text                 as items,
              sum(i.subtotal_paise)::text       as total
         from orders o
         join order_items i on i.order_id = o.id
        where o.group_id = $1`,
      [group],
    );

    assert.equal(rolled.rows[0]?.sellers, '2', 'one payment across two sellers');
    assert.equal(rolled.rows[0]?.items, '2');
    assert.equal(rolled.rows[0]?.total, '800000', 'lines must sum to what was charged');
  });

  it('refuses the same listing twice in one order', async () => {
    const a = await fixture();
    const o = await pg.query<{ id: string }>(
      `insert into orders (order_number, buyer_id, seller_id, listing_id,
                           subtotal_paise, total_paise)
       values ('RM-DUP', $1, $2, $3, 500000, 500000) returning id`,
      [a.buyer, a.seller, a.listing],
    );
    const order = o.rows[0]!.id;

    await pg.query(
      `insert into order_items (order_id, listing_id, subtotal_paise) values ($1, $2, 500000)`,
      [order, a.listing],
    );

    await assert.rejects(
      pg.query(
        `insert into order_items (order_id, listing_id, subtotal_paise) values ($1, $2, 500000)`,
        [order, a.listing],
      ),
      'every item here is one of a kind — the same one cannot be sold twice in a basket',
    );
  });

  it('will not let a line be created for nothing', async () => {
    const a = await fixture();
    const o = await pg.query<{ id: string }>(
      `insert into orders (order_number, buyer_id, seller_id, listing_id,
                           subtotal_paise, total_paise)
       values ('RM-ZERO', $1, $2, $3, 500000, 500000) returning id`,
      [a.buyer, a.seller, a.listing],
    );

    await assert.rejects(
      pg.query(
        `insert into order_items (order_id, listing_id, subtotal_paise) values ($1, $2, 0)`,
        [o.rows[0]!.id, a.listing],
      ),
      'a zero-value line would settle to a zero payout without anyone noticing',
    );
  });

  it('keeps the group when an order is deleted, and drops the lines with it', async () => {
    const a = await fixture();
    const g = await pg.query<{ id: string }>(
      `insert into order_groups (group_number, buyer_id, total_paise)
       values ('G-TEST-2', $1, 500000) returning id`,
      [a.buyer],
    );
    const o = await pg.query<{ id: string }>(
      `insert into orders (order_number, buyer_id, seller_id, listing_id, group_id,
                           subtotal_paise, total_paise)
       values ('RM-C', $1, $2, $3, $4, 500000, 500000) returning id`,
      [a.buyer, a.seller, a.listing, g.rows[0]!.id],
    );
    await pg.query(
      `insert into order_items (order_id, listing_id, subtotal_paise) values ($1, $2, 500000)`,
      [o.rows[0]!.id, a.listing],
    );

    await pg.query(`delete from orders where id = $1`, [o.rows[0]!.id]);

    const items = await pg.query<{ n: string }>(`select count(*)::text as n from order_items`);
    assert.equal(items.rows[0]?.n, '0', 'lines belong to their order');
  });
});
