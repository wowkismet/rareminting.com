/**
 * The buyer's dashboard.
 *
 * One request draws the whole page — orders, bids, wishlist, cart and
 * collections — for the same reason the seller's does: the page somebody opens
 * most often should not assemble itself through a waterfall of round trips.
 *
 * What is deliberately absent is as considered as what is here. There is no
 * wallet balance, no loyalty points and no viewing history, because there is no
 * wallet, no points ledger and no per-user view table behind them. A number
 * with nothing behind it is worse on a page about somebody's own money than
 * anywhere else on the site.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { unauthorized } from '../errors.ts';
import type { Database } from '../db.ts';

/** Orders that are over, one way or another. */
const CLOSED = `('completed','cancelled','refunded')`;

/** Orders whose money never arrived, and so was never spent. */
const VOID = `('cancelled','refunded')`;

export function registerBuyerRoutes(router: Router, _database: Database): void {
  /** GET /v1/me/dashboard — everything the buyer's overview shows. */
  router.add('GET', '/v1/me/dashboard', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;

    const counts = await ctx.db.query<Record<string, string>>(
      `select
         (select count(*) from orders where buyer_id = $1)::text            as orders,
         (select count(*) from orders
           where buyer_id = $1 and state not in ${CLOSED})::text            as orders_open,
         (select coalesce(sum(total_paise), 0) from orders
           where buyer_id = $1 and state not in ${VOID})::text              as spent_paise,
         (select count(*) from cart_items  where buyer_id = $1)::text       as cart,
         (select count(*) from saved_items where buyer_id = $1)::text       as saved,
         (select count(*) from collections where user_id  = $1)::text       as collections,
         (select created_at::text from users where id = $1)                 as member_since`,
      [userId],
    );

    // Bids the buyer still stands to win: their own, not retracted, on an
    // auction that is still running. A bid on a closed auction is history, and
    // belongs under orders rather than here.
    const bids = await ctx.db.query<{
      auction_id: string;
      listing_id: string;
      title: string;
      serial_digits: string | null;
      my_max_paise: string;
      current_paise: string | null;
      bid_count: number;
      ends_at: string;
      leading: boolean;
      thumb: string | null;
    }>(
      `select a.id as auction_id, a.listing_id, l.title, n.serial_digits,
              max(b.amount_paise)::text as my_max_paise,
              a.current_paise::text     as current_paise,
              a.bid_count,
              a.ends_at::text           as ends_at,
              (a.current_paise is not null
                 and max(b.amount_paise) >= a.current_paise) as leading,
              (select m.storage_key from media m
                where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb
         from bids b
         join auctions a on a.id = b.auction_id
         join listings l on l.id = a.listing_id
         left join notes n on n.listing_id = l.id
        where b.bidder_id = $1
          and b.is_retracted = false
          and a.state = 'live'
        group by a.id, a.listing_id, l.title, l.id, n.serial_digits,
                 a.current_paise, a.bid_count, a.ends_at
        order by a.ends_at asc
        limit 20`,
      [userId],
    );

    const recent = await ctx.db.query<{
      id: string;
      order_number: string;
      state: string;
      total_paise: string;
      created_at: string;
      title: string | null;
      thumb: string | null;
    }>(
      `select o.id, o.order_number, o.state, o.total_paise::text as total_paise,
              o.created_at::text as created_at, l.title,
              (select m.storage_key from media m
                where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb
         from orders o
         left join listings l on l.id = o.listing_id
        where o.buyer_id = $1
        order by o.created_at desc
        limit 5`,
      [userId],
    );

    const c = (counts.rows[0] ?? {}) as Record<string, string>;
    const n = (k: string): number => Number(c[k] ?? 0);

    return json({
      stats: {
        orders: n('orders'),
        ordersOpen: n('orders_open'),
        spentInr: n('spent_paise') / 100,
        cart: n('cart'),
        saved: n('saved'),
        collections: n('collections'),
        activeBids: bids.rows.length,
      },
      memberSince: c['member_since'] ?? null,
      bids: bids.rows.map((b) => ({
        auctionId: b.auction_id,
        listingId: b.listing_id,
        title: b.title,
        serialDigits: b.serial_digits,
        myMaxInr: Number(b.my_max_paise) / 100,
        currentInr: b.current_paise === null ? null : Number(b.current_paise) / 100,
        bidCount: b.bid_count,
        endsAt: b.ends_at,
        // Whether the buyer is currently the one to beat.
        leading: b.leading,
        imageUrl: b.thumb === null ? null : `/media/${b.thumb}`,
      })),
      recentOrders: recent.rows.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        state: o.state,
        totalInr: Number(o.total_paise) / 100,
        title: o.title,
        imageUrl: o.thumb === null ? null : `/media/${o.thumb}`,
        createdAt: o.created_at,
      })),
    });
  });
}
