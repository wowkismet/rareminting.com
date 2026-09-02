/**
 * Auctions.
 *
 * Time is server time, always. A client that says the auction is still open is
 * not consulted; every decision here is made against `now()` in the database,
 * because the alternative is a bidder with a slow clock losing a lot they won,
 * or a fast one winning a lot they did not.
 *
 * Auctions close lazily. There is no scheduler: an auction whose end has passed
 * is closed the next time anybody looks at it or tries to bid on it. That means
 * one less moving part to fail silently at three in the morning, and it cannot
 * accept a late bid — the close happens before the bid is considered.
 *
 * The bid ledger is append-only, enforced by database triggers rather than by
 * convention, so a disputed auction can be reconstructed exactly.
 */

import { randomUUID } from 'node:crypto';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { one, type Database, type Db } from '../db.ts';
import {
  applyAntiSnipe,
  increment,
  minimumBid,
  placeBid,
  reserveMet,
  type ProxyState,
} from '../auction-engine.ts';
import { requireApprovedSeller } from './sellers.ts';

const AUCTION_KINDS = ['english', 'reserve', 'no_reserve'] as const;

/** Sane bounds on how long an auction may run. */
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_DAYS = 30;

interface AuctionRow {
  id: string;
  listing_id: string;
  kind: string;
  state: string;
  starting_paise: string;
  reserve_paise: string | null;
  current_paise: string | null;
  bid_count: number;
  starts_at: string;
  ends_at: string;
  anti_snipe_seconds: number;
  extension_count: number;
  max_extensions: number;
  winner_id: string | null;
  winning_paise: string | null;
}

function rupees(paise: string | number | null): number | null {
  if (paise === null) return null;
  return Number(paise) / 100;
}

/**
 * The current proxy state, derived from the ledger.
 *
 * Recomputed from bids rather than trusted from the auctions row: the ledger is
 * append-only and therefore the authority, and a derived column that drifts
 * would be invisible until somebody disputed a result.
 */
async function proxyStateOf(db: Db, auctionId: string): Promise<ProxyState> {
  const rows = await db.query<{ bidder_id: string; max_proxy_paise: string }>(
    `select bidder_id, max_proxy_paise::text as max_proxy_paise
       from bids
      where auction_id = $1 and not is_retracted and max_proxy_paise is not null
      order by placed_at asc, id asc`,
    [auctionId],
  );

  const current = await db.query<{ current_paise: string | null }>(
    `select current_paise::text as current_paise from auctions where id = $1`,
    [auctionId],
  );

  const leader = rows.rows.reduce<{ id: string; max: number } | null>((best, row) => {
    const max = Number(row.max_proxy_paise);
    // Strictly greater: a tie leaves the earlier bidder in front.
    return best === null || max > best.max ? { id: row.bidder_id, max } : best;
  }, null);

  return {
    currentPaise: Number(current.rows[0]?.current_paise ?? 0),
    leaderId: leader?.id ?? null,
    leaderMaxPaise: leader?.max ?? 0,
  };
}

/**
 * Close an auction whose time has passed.
 *
 * Idempotent and safe to call from anywhere: the UPDATE is conditional on the
 * auction still being open, so two concurrent readers cannot both close it.
 */
async function closeIfDue(database: Database, auctionId: string): Promise<boolean> {
  return database.transaction(async (tx) => {
    const found = one(
      await tx.query<AuctionRow>(
        `select id, listing_id, kind, state, starting_paise::text as starting_paise,
                reserve_paise::text as reserve_paise, current_paise::text as current_paise,
                bid_count, starts_at::text as starts_at, ends_at::text as ends_at,
                anti_snipe_seconds, extension_count, max_extensions,
                winner_id, winning_paise::text as winning_paise
           from auctions
          where id = $1 and state in ('live', 'extended') and ends_at <= now()
          for update`,
        [auctionId],
      ),
    );
    if (found === null) return false;

    const state = await proxyStateOf(tx, auctionId);
    const met = reserveMet(state.currentPaise, found.reserve_paise === null ? null : Number(found.reserve_paise));
    const hasWinner = state.leaderId !== null && met;

    await tx.query(
      `update auctions
          set state = 'ended',
              winner_id = $2,
              winning_paise = $3
        where id = $1`,
      [auctionId, hasWinner ? state.leaderId : null, hasWinner ? state.currentPaise : null],
    );

    // An unsold lot goes back on the shelf; a won one waits for the buyer to
    // pay, exactly as a fixed-price reservation does.
    await tx.query(
      `update listings set state = $2 where id = $1 and state in ('minted', 'reserved')`,
      [found.listing_id, hasWinner ? 'reserved' : 'minted'],
    );

    return true;
  });
}

export function registerAuctionRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/listings/:id/auction — put a draft up for auction.
   *
   * Only from draft, and only by the seller who owns it: converting a listing
   * that somebody is already buying would pull it out from under them.
   */
  router.add('POST', '/v1/listings/:id/auction', async (ctx) => {
    const seller = await requireApprovedSeller(ctx);
    const listingId = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) throw notFound('No such listing.');

    const fields = asObject(await ctx.body());
    const kind = fields['kind'] === undefined ? 'english' : oneOf(fields, 'kind', AUCTION_KINDS);
    const startingInr = fields['startingInr'];
    if (typeof startingInr !== 'number' || !Number.isFinite(startingInr) || startingInr <= 0) {
      throw badRequest('Set a starting price in rupees.', { startingInr: 'invalid' });
    }
    const startingPaise = Math.round(startingInr * 100);

    let reservePaise: number | null = null;
    if (fields['reserveInr'] !== undefined && fields['reserveInr'] !== null) {
      const value = fields['reserveInr'];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw badRequest('A reserve must be a price in rupees.', { reserveInr: 'invalid' });
      }
      reservePaise = Math.round(value * 100);
      if (reservePaise < startingPaise) {
        throw badRequest('A reserve below the starting price has no effect.', {
          reserveInr: 'below_starting',
        });
      }
    }

    const endsAtRaw = requiredString(fields, 'endsAt', 40);
    const endsAt = new Date(endsAtRaw);
    if (Number.isNaN(endsAt.getTime())) {
      throw badRequest('endsAt must be a date and time.', { endsAt: 'invalid' });
    }
    const hours = (endsAt.getTime() - Date.now()) / 3_600_000;
    if (hours < MIN_DURATION_HOURS) {
      throw badRequest(`An auction must run for at least ${MIN_DURATION_HOURS} hour.`, {
        endsAt: 'too_soon',
      });
    }
    if (hours > MAX_DURATION_DAYS * 24) {
      throw badRequest(`An auction may not run longer than ${MAX_DURATION_DAYS} days.`, {
        endsAt: 'too_far',
      });
    }

    const listing = one(
      await ctx.db.query<{ seller_id: string; state: string }>(
        `select seller_id, state from listings where id = $1`,
        [listingId],
      ),
    );
    if (listing === null || listing.seller_id !== seller.id) throw notFound('No such listing.');
    if (listing.state !== 'draft') {
      throw conflict(`Only a draft can be put up for auction; this listing is ${listing.state}.`);
    }

    const created = await database.transaction(async (tx) => {
      const inserted = await tx.query<AuctionRow>(
        `insert into auctions
           (listing_id, kind, state, starting_paise, reserve_paise, current_paise,
            starts_at, ends_at)
         values ($1, $2::auction_kind, 'live', $3, $4, $3, now(), $5)
         returning id, listing_id, kind, state, starting_paise::text as starting_paise,
                   reserve_paise::text as reserve_paise, current_paise::text as current_paise,
                   bid_count, starts_at::text as starts_at, ends_at::text as ends_at,
                   anti_snipe_seconds, extension_count, max_extensions,
                   winner_id, winning_paise::text as winning_paise`,
        [listingId, kind, startingPaise, reservePaise, endsAt.toISOString()],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error('failed to create auction');

      // Live and visible, and sold by bidding rather than at a fixed price.
      await tx.query(
        `update listings set sale_mode = 'auction', state = 'minted', published_at = now()
          where id = $1`,
        [listingId],
      );

      return row;
    });

    return json({ auction: publicAuction(created, null) }, 201);
  });

  /** GET /v1/auctions — what is running now, soonest to close first. */
  router.add('GET', '/v1/auctions', async (ctx) => {
    // Close anything that has run out before reporting, so an ended auction is
    // never listed as live.
    const due = await ctx.db.query<{ id: string }>(
      `select id from auctions where state in ('live','extended') and ends_at <= now() limit 50`,
    );
    for (const row of due.rows) await closeIfDue(database, row.id);

    const rows = await ctx.db.query<
      AuctionRow & { title: string; grade: string | null; thumb: string | null; serial_digits: string | null }
    >(
      `select a.id, a.listing_id, a.kind, a.state, a.starting_paise::text as starting_paise,
              a.reserve_paise::text as reserve_paise, a.current_paise::text as current_paise,
              a.bid_count, a.starts_at::text as starts_at, a.ends_at::text as ends_at,
              a.anti_snipe_seconds, a.extension_count, a.max_extensions,
              a.winner_id, a.winning_paise::text as winning_paise,
              l.title, l.grade, n.serial_digits,
              (select m.storage_key from media m
                where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb
         from auctions a
         join listings l on l.id = a.listing_id
         left join notes n on n.listing_id = l.id
        where a.state in ('live', 'extended')
        order by a.ends_at asc
        limit 60`,
    );

    return json({
      auctions: rows.rows.map((r) => ({
        ...publicAuction(r, null),
        title: r.title,
        grade: r.grade,
        serialDigits: r.serial_digits,
        imageUrl: r.thumb === null ? null : `/media/${r.thumb}`,
      })),
    });
  });

  /** GET /v1/auctions/:id — one lot, with its ledger. */
  router.add('GET', '/v1/auctions/:id', async (ctx) => {
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such auction.');

    await closeIfDue(database, id);

    const found = one(
      await ctx.db.query<AuctionRow & { title: string; listing_state: string }>(
        `select a.id, a.listing_id, a.kind, a.state, a.starting_paise::text as starting_paise,
                a.reserve_paise::text as reserve_paise, a.current_paise::text as current_paise,
                a.bid_count, a.starts_at::text as starts_at, a.ends_at::text as ends_at,
                a.anti_snipe_seconds, a.extension_count, a.max_extensions,
                a.winner_id, a.winning_paise::text as winning_paise,
                l.title, l.state as listing_state
           from auctions a join listings l on l.id = a.listing_id
          where a.id = $1`,
        [id],
      ),
    );
    if (found === null) throw notFound('No such auction.');

    const state = await proxyStateOf(ctx.db, id);

    // The ledger, without revealing anybody's ceiling. A maximum is private:
    // knowing it would tell a rival exactly what to bid.
    const bids = await ctx.db.query<{
      amount_paise: string;
      placed_at: string;
      bidder_id: string;
    }>(
      `select amount_paise::text as amount_paise, placed_at::text as placed_at, bidder_id
         from bids
        where auction_id = $1 and not is_retracted
        order by placed_at desc, id desc
        limit 50`,
      [id],
    );

    const viewer = ctx.session?.userId ?? null;

    return json({
      auction: {
        ...publicAuction(found, state),
        title: found.title,
        listingState: found.listing_state,
        youAreWinning: viewer !== null && state.leaderId === viewer,
        // Only ever your own ceiling.
        yourMaxInr: viewer !== null && state.leaderId === viewer ? rupees(state.leaderMaxPaise) : null,
      },
      bids: bids.rows.map((b, index) => ({
        amountInr: rupees(b.amount_paise),
        placedAt: b.placed_at,
        // Bidders are anonymous to each other, which is the convention at
        // auction and stops rivals being targeted between lots.
        bidder: b.bidder_id === viewer ? 'You' : `Bidder ${bids.rows.length - index}`,
      })),
    });
  });

  /**
   * POST /v1/auctions/:id/bids
   *
   * Body: maxInr, and a clientNonce so a retry or a double-tap places one bid
   * rather than two.
   */
  router.add('POST', '/v1/auctions/:id/bids', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such auction.');

    const fields = asObject(await ctx.body());
    const maxInr = fields['maxInr'];
    if (typeof maxInr !== 'number' || !Number.isFinite(maxInr) || maxInr <= 0) {
      throw badRequest('Enter the most you are willing to pay, in rupees.', { maxInr: 'invalid' });
    }
    const maxPaise = Math.round(maxInr * 100);
    const nonce = optionalString(fields, 'clientNonce', 64) ?? randomUUID();

    // Close first. An auction that has run out must never take another bid.
    await closeIfDue(database, id);

    const result = await database.transaction(async (tx) => {
      const auction = one(
        await tx.query<AuctionRow & { seller_user_id: string }>(
          `select a.id, a.listing_id, a.kind, a.state, a.starting_paise::text as starting_paise,
                  a.reserve_paise::text as reserve_paise, a.current_paise::text as current_paise,
                  a.bid_count, a.starts_at::text as starts_at, a.ends_at::text as ends_at,
                  a.anti_snipe_seconds, a.extension_count, a.max_extensions,
                  a.winner_id, a.winning_paise::text as winning_paise,
                  s.user_id as seller_user_id
             from auctions a
             join listings l on l.id = a.listing_id
             join sellers s on s.id = l.seller_id
            where a.id = $1
            for update of a`,
          [id],
        ),
      );
      if (auction === null) return { kind: 'not_found' as const };

      if (auction.state !== 'live' && auction.state !== 'extended') {
        return { kind: 'closed' as const, state: auction.state };
      }
      // A seller bidding on their own lot is shill bidding.
      if (auction.seller_user_id === session.userId) {
        return { kind: 'own_lot' as const };
      }

      const before = await proxyStateOf(tx, id);
      const outcome = placeBid(before, Number(auction.starting_paise), session.userId, maxPaise);

      if (!outcome.ok) {
        return {
          kind: 'rejected' as const,
          reason: outcome.reason,
          minimumInr:
            outcome.reason === 'below_minimum'
              ? rupees(outcome.minimumPaise)
              : rupees(minimumBid(before, Number(auction.starting_paise))),
        };
      }

      const snipe = applyAntiSnipe(
        new Date(auction.ends_at),
        new Date(),
        auction.anti_snipe_seconds,
        auction.extension_count,
        auction.max_extensions,
      );

      // What this bidder is actually on the hook for — never more than the
      // maximum they stated. For whoever is leading that is the current price;
      // for somebody outbid it is their own ceiling, which the price rose to
      // meet. The schema enforces the same thing (max_proxy_paise >=
      // amount_paise), so recording the auction price here would be rejected
      // outright for a losing bidder.
      const committedPaise = Math.min(outcome.state.currentPaise, maxPaise);

      // The unique index on (auction, bidder, nonce) makes a retry a no-op.
      await tx.query(
        `insert into bids
           (auction_id, bidder_id, amount_paise, max_proxy_paise, is_proxy,
            client_nonce, ip, user_agent)
         values ($1, $2, $3, $4, false, $5, $6::inet, $7)
         on conflict (auction_id, bidder_id, client_nonce) do nothing`,
        [id, session.userId, committedPaise, maxPaise, nonce, ctx.ip, ctx.userAgent],
      );

      await tx.query(
        `update auctions
            set current_paise = $2,
                bid_count = bid_count + 1,
                ends_at = $3,
                extension_count = extension_count + $4,
                state = case when $5 then 'extended'::auction_state else state end
          where id = $1`,
        [
          id,
          outcome.state.currentPaise,
          snipe.endsAt.toISOString(),
          snipe.extended ? 1 : 0,
          snipe.extended,
        ],
      );

      return {
        kind: 'placed' as const,
        state: outcome.state,
        tookLead: outcome.tookLead,
        endsAt: snipe.endsAt.toISOString(),
        extended: snipe.extended,
        reserveMet: reserveMet(
          outcome.state.currentPaise,
          auction.reserve_paise === null ? null : Number(auction.reserve_paise),
        ),
      };
    });

    if (result.kind === 'not_found') throw notFound('No such auction.');
    if (result.kind === 'own_lot') throw forbidden('You cannot bid on your own lot.');
    if (result.kind === 'closed') {
      throw conflict('This auction has closed.');
    }
    if (result.kind === 'rejected') {
      throw badRequest(
        result.reason === 'not_higher'
          ? 'That is not more than your current maximum.'
          : `Bid at least ₹${(result.minimumInr ?? 0).toLocaleString('en-IN')}.`,
        { maxInr: result.reason },
      );
    }

    return json(
      {
        currentInr: rupees(result.state.currentPaise),
        youAreWinning: result.tookLead,
        yourMaxInr: rupees(maxPaise),
        endsAt: result.endsAt,
        extended: result.extended,
        reserveMet: result.reserveMet,
        nextMinimumInr: rupees(
          result.state.currentPaise + increment(result.state.currentPaise),
        ),
      },
      201,
    );
  });
}

function publicAuction(row: AuctionRow, state: ProxyState | null): Record<string, unknown> {
  const current = state?.currentPaise ?? Number(row.current_paise ?? row.starting_paise);
  return {
    id: row.id,
    listingId: row.listing_id,
    kind: row.kind,
    state: row.state,
    startingInr: rupees(row.starting_paise),
    currentInr: current / 100,
    // Whether a reserve exists and whether it is met, never what it is.
    hasReserve: row.reserve_paise !== null,
    reserveMet: reserveMet(current, row.reserve_paise === null ? null : Number(row.reserve_paise)),
    bidCount: row.bid_count,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    extensionCount: row.extension_count,
    antiSnipeSeconds: row.anti_snipe_seconds,
    winnerId: row.winner_id,
    winningInr: rupees(row.winning_paise),
    nextMinimumInr: (current + increment(current)) / 100,
  };
}
