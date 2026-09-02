import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Auctions, end to end against real PostgreSQL.
 *
 * The hostile cases: a seller bidding on their own lot, a bid arriving after
 * the close, the same bid submitted twice, and whether a rival can learn
 * somebody else's maximum.
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
  await pg.exec('truncate bids, auctions cascade;');
});

let accounts = 0;
async function account(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `auc${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

function inHours(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

async function approvedSellerToken(): Promise<string> {
  const token = await account();
  const reg = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, seller.id);
  return token;
}

async function draftListing(token: string): Promise<string> {
  accounts += 1;
  const created = await request(app, 'POST', '/v1/listings', {
    token,
    body: {
      serial: `9AB ${String(300000 + accounts).padStart(6, '0')}`,
      denomination: 100,
      series: 'Mahatma Gandhi New Series',
      priceInr: 4500,
    },
  });
  const { listing } = (await created.json()) as { listing: { id: string } };
  return listing.id;
}

/** A live auction. Returns the seller token and the auction id. */
async function liveAuction(
  opts: { startingInr?: number; reserveInr?: number; endsAt?: string } = {},
): Promise<{ sellerToken: string; auctionId: string; listingId: string }> {
  const sellerToken = await approvedSellerToken();
  const listingId = await draftListing(sellerToken);

  const auction = await request(app, 'POST', `/v1/listings/${listingId}/auction`, {
    token: sellerToken,
    body: {
      startingInr: opts.startingInr ?? 1000,
      ...(opts.reserveInr === undefined ? {} : { reserveInr: opts.reserveInr }),
      endsAt: opts.endsAt ?? inHours(24),
    },
  });
  assert.equal(auction.status, 201, await auction.clone().text());
  const body = (await auction.json()) as { auction: { id: string } };

  return { sellerToken, auctionId: body.auction.id, listingId };
}

function bid(token: string, auctionId: string, maxInr: number, nonce?: string): Promise<Response> {
  return request(app, 'POST', `/v1/auctions/${auctionId}/bids`, {
    token,
    body: { maxInr, ...(nonce === undefined ? {} : { clientNonce: nonce }) },
  });
}

/** Wind the whole window into the past — the schema requires ends after starts. */
async function expire(auctionId: string): Promise<void> {
  await pg.query(
    `update auctions
        set starts_at = now() - interval '2 hours',
            ends_at   = now() - interval '1 minute'
      where id = $1`,
    [auctionId],
  );
}

describe('creating an auction', () => {
  it('publishes the listing and opens at the starting price', async () => {
    const { auctionId, listingId } = await liveAuction({ startingInr: 1000 });

    const res = await request(app, 'GET', `/v1/auctions/${auctionId}`);
    const body = (await res.json()) as {
      auction: { state: string; currentInr: number; bidCount: number };
    };
    assert.equal(body.auction.state, 'live');
    assert.equal(body.auction.currentInr, 1000);
    assert.equal(body.auction.bidCount, 0);

    const listing = await pg.query<{ state: string; sale_mode: string }>(
      `select state, sale_mode from listings where id = $1`,
      [listingId],
    );
    assert.equal(listing.rows[0]!.state, 'minted');
    assert.equal(listing.rows[0]!.sale_mode, 'auction');
  });

  it('refuses a reserve below the starting price', async () => {
    const token = await approvedSellerToken();
    const listingId = await draftListing(token);

    const res = await request(app, 'POST', `/v1/listings/${listingId}/auction`, {
      token,
      body: { startingInr: 1000, reserveInr: 500, endsAt: inHours(24) },
    });
    assert.equal(res.status, 400);
  });

  it('refuses an auction that ends too soon or runs too long', async () => {
    for (const endsAt of [inHours(0.1), inHours(24 * 60)]) {
      const token = await approvedSellerToken();
      const listingId = await draftListing(token);
      const res = await request(app, 'POST', `/v1/listings/${listingId}/auction`, {
        token,
        body: { startingInr: 100, endsAt },
      });
      assert.equal(res.status, 400, `accepted endsAt ${endsAt}`);
    }
  });

  it('refuses somebody auctioning a listing that is not theirs', async () => {
    const { listingId } = await liveAuction();
    const stranger = await approvedSellerToken();
    const res = await request(app, 'POST', `/v1/listings/${listingId}/auction`, {
      token: stranger,
      body: { startingInr: 100, endsAt: inHours(24) },
    });
    assert.equal(res.status, 404);
  });
});

describe('bidding', () => {
  it('opens at the starting price, not at the maximum offered', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();

    const res = await bid(alice, auctionId, 5000);
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as { currentInr: number; youAreWinning: boolean };
    assert.equal(body.currentInr, 1000, 'the first bidder bid against themselves');
    assert.equal(body.youAreWinning, true);
  });

  it('lets a higher maximum take the lead without paying it in full', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();
    const bob = await account();

    await bid(alice, auctionId, 2000);
    const res = await bid(bob, auctionId, 9000);
    const body = (await res.json()) as { currentInr: number; youAreWinning: boolean };

    assert.equal(body.youAreWinning, true);
    assert.ok(body.currentInr > 2000, 'must clear the previous leader');
    assert.ok(body.currentInr < 9000, 'the winner should not pay their whole maximum');
  });

  it('refuses a seller bidding on their own lot', async () => {
    const { sellerToken, auctionId } = await liveAuction();
    const res = await bid(sellerToken, auctionId, 5000);
    assert.equal(res.status, 403, 'shill bidding was allowed');
  });

  it('requires signing in', async () => {
    const { auctionId } = await liveAuction();
    const res = await request(app, 'POST', `/v1/auctions/${auctionId}/bids`, {
      body: { maxInr: 5000 },
    });
    assert.equal(res.status, 401);
  });

  it('refuses a bid below the minimum', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();
    const res = await bid(alice, auctionId, 500);
    assert.equal(res.status, 400);
  });

  it('counts a retried bid once', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();

    await bid(alice, auctionId, 5000, 'same-nonce');
    await bid(alice, auctionId, 5000, 'same-nonce');

    const rows = await pg.query<{ n: string }>(`select count(*)::text as n from bids`);
    assert.equal(rows.rows[0]!.n, '1', 'a double-tap placed two bids');
  });

  it('never reveals the maximum of another bidder', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();
    const bob = await account();

    await bid(alice, auctionId, 50_000);
    await bid(bob, auctionId, 2000);

    const res = await request(app, 'GET', `/v1/auctions/${auctionId}`, { token: bob });
    const text = await res.text();
    assert.equal(text.includes('50000'), false, 'a ceiling leaked to a rival');

    const body = JSON.parse(text) as { auction: { yourMaxInr: number | null } };
    assert.equal(body.auction.yourMaxInr, null, 'a losing bidder has no ceiling to show');
  });

  it('keeps the ledger append-only', async () => {
    const { auctionId } = await liveAuction();
    const alice = await account();
    await bid(alice, auctionId, 5000);

    await assert.rejects(
      pg.query(`update bids set amount_paise = 1 where auction_id = $1`, [auctionId]),
      'the bid ledger was rewritable',
    );
    await assert.rejects(
      pg.query(`delete from bids where auction_id = $1`, [auctionId]),
      'a bid was deletable',
    );
  });
});

describe('reserve', () => {
  it('reports whether it is met, never what it is', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000, reserveInr: 5000 });
    const alice = await account();

    // Opens at ₹1,000, well under the reserve.
    const low = await bid(alice, auctionId, 2000);
    assert.equal(((await low.json()) as { reserveMet: boolean }).reserveMet, false);

    // A rival with a ₹9,000 ceiling is not enough on its own: proxy bidding
    // only lifts the price one increment past ₹2,000, still short of ₹5,000.
    const bob = await account();
    const partial = await bid(bob, auctionId, 9000);
    assert.equal(
      ((await partial.json()) as { reserveMet: boolean }).reserveMet,
      false,
      'the price only rises as far as it must, so the reserve is still unmet',
    );

    // Alice pushing her own ceiling up is what actually drives it there.
    const high = await bid(alice, auctionId, 8000);
    assert.equal(((await high.json()) as { reserveMet: boolean }).reserveMet, true);

    const res = await request(app, 'GET', `/v1/auctions/${auctionId}`);
    const text = await res.text();
    const body = JSON.parse(text) as { auction: { hasReserve: boolean } };
    assert.equal(body.auction.hasReserve, true);
    assert.equal(text.includes('"reserveInr"'), false, 'the reserve amount leaked');
  });
});

describe('closing', () => {
  it('closes when the time has passed and names a winner', async () => {
    const { auctionId, listingId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();
    await bid(alice, auctionId, 5000);

    await expire(auctionId);

    const res = await request(app, 'GET', `/v1/auctions/${auctionId}`);
    const body = (await res.json()) as { auction: { state: string; winningInr: number | null } };
    assert.equal(body.auction.state, 'ended');
    assert.equal(body.auction.winningInr, 1000);

    const listing = await pg.query<{ state: string }>(`select state from listings where id = $1`, [
      listingId,
    ]);
    assert.equal(listing.rows[0]!.state, 'reserved', 'a won lot should be held for the winner');
  });

  it('refuses a bid after the close', async () => {
    const { auctionId } = await liveAuction();
    await expire(auctionId);

    const alice = await account();
    const res = await bid(alice, auctionId, 9000);
    assert.equal(res.status, 409, 'a late bid was accepted');
  });

  it('leaves an unsold lot for sale when the reserve was not met', async () => {
    const { auctionId, listingId } = await liveAuction({ startingInr: 1000, reserveInr: 50_000 });
    const alice = await account();
    await bid(alice, auctionId, 2000);

    await expire(auctionId);
    const res = await request(app, 'GET', `/v1/auctions/${auctionId}`);
    const body = (await res.json()) as { auction: { winnerId: string | null } };
    assert.equal(body.auction.winnerId, null, 'the reserve was not met, so there is no winner');

    const listing = await pg.query<{ state: string }>(`select state from listings where id = $1`, [
      listingId,
    ]);
    assert.equal(listing.rows[0]!.state, 'minted', 'an unsold lot goes back on the shelf');
  });

  it('lists only live auctions', async () => {
    const first = await liveAuction();
    const second = await liveAuction();
    await expire(first.auctionId);

    const res = await request(app, 'GET', '/v1/auctions');
    const body = (await res.json()) as { auctions: { id: string }[] };
    const ids = body.auctions.map((a) => a.id);
    assert.equal(ids.includes(second.auctionId), true);
    assert.equal(ids.includes(first.auctionId), false, 'an ended auction was listed as live');
  });
});

describe('anti-sniping', () => {
  it('extends the close when a bid lands in the final seconds', async () => {
    const { auctionId } = await liveAuction({ startingInr: 1000 });
    const alice = await account();
    await bid(alice, auctionId, 2000);

    // 30 seconds left, inside the default 120-second window.
    await pg.query(`update auctions set ends_at = now() + interval '30 seconds' where id = $1`, [
      auctionId,
    ]);

    const bob = await account();
    const res = await bid(bob, auctionId, 9000);
    const body = (await res.json()) as { extended: boolean; endsAt: string };
    assert.equal(body.extended, true, 'a snipe went unanswered');
    assert.ok(
      new Date(body.endsAt).getTime() - Date.now() > 60_000,
      'the close should have moved comfortably out',
    );
  });

  it('does not extend an auction with hours left', async () => {
    const { auctionId } = await liveAuction();
    const alice = await account();
    const res = await bid(alice, auctionId, 5000);
    assert.equal(((await res.json()) as { extended: boolean }).extended, false);
  });
});
