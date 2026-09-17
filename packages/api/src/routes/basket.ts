/**
 * The cart, and the list of things saved for later.
 *
 * Neither reserves anything. A note comes off the market when an order is
 * placed, not when somebody adds it to a cart — otherwise one buyer could
 * freeze the entire floor by adding everything to theirs and walking away.
 *
 * The consequence is that a cart can contain something already sold, which is
 * a fact of a marketplace where every item is unique. Rather than hide it, the
 * cart says so on each line and refuses to check that line out.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, notFound, unauthorized } from '../errors.ts';
import { asObject, optionalString } from '../validate.ts';
import { one, type Database } from '../db.ts';

/** Listing states a buyer can still act on. */
const BUYABLE = 'minted';

interface BasketRow {
  listing_id: string;
  added_at: string;
  note: string | null;
  title: string;
  state: string;
  sale_mode: string;
  price_paise: string | null;
  grade: string | null;
  serial_digits: string | null;
  denomination: number | null;
  thumb: string | null;
  seller_name: string;
  // Null on every saved item, and on any cart line without a frame.
  frame_code: string | null;
  frame_photo_key: string | null;
  frame_message: string | null;
  frame_recipient: string | null;
  frame_sender: string | null;
  frame_occasion_on: string | null;
}

function shape(row: BasketRow): Record<string, unknown> {
  return {
    listingId: row.listing_id,
    title: row.title,
    state: row.state,
    saleMode: row.sale_mode,
    priceInr: row.price_paise === null ? null : Number(row.price_paise) / 100,
    grade: row.grade,
    serialDigits: row.serial_digits,
    denomination: row.denomination,
    imageUrl: row.thumb === null ? null : `/media/${row.thumb}`,
    sellerName: row.seller_name,
    addedAt: row.added_at,
    // The one thing the buyer needs to know per line.
    available: row.state === BUYABLE,
    ...(row.note === null ? {} : { note: row.note }),
    // What was chosen for this line, if anything. The photograph is handed
    // back as the authenticated route rather than a path, because it is not
    // served from anywhere a plain URL would reach.
    frame: {
      code: row.frame_code ?? null,
      photoUrl: row.frame_photo_key === null ? null : `/v1/gift-photo/${row.frame_photo_key}`,
      message: row.frame_message ?? null,
      recipient: row.frame_recipient ?? null,
      sender: row.frame_sender ?? null,
      occasionOn: row.frame_occasion_on ?? null,
    },
  };
}

/** The shared select. `table` is a literal, never user input. */
function listQuery(table: 'cart_items' | 'saved_items'): string {
  const noteColumn = table === 'saved_items' ? 'c.note' : 'null::text as note';

  // A frame only ever hangs off a cart line. Saved items have none, so the
  // columns come back as nulls there rather than the two queries diverging
  // into different shapes the caller would have to tell apart.
  const cart = table === 'cart_items';
  const frameColumns = cart
    ? `f.code as frame_code, c.frame_photo_key, c.frame_message,
       c.frame_recipient, c.frame_sender, c.frame_occasion_on::text as frame_occasion_on`
    : `null::text as frame_code, null::text as frame_photo_key, null::text as frame_message,
       null::text as frame_recipient, null::text as frame_sender,
       null::text as frame_occasion_on`;
  const frameJoin = cart ? 'left join frame_templates f on f.id = c.frame_template_id' : '';

  return `select c.listing_id, c.added_at::text as added_at, ${noteColumn},
                 ${frameColumns},
                 l.title, l.state, l.sale_mode, l.price_paise::text as price_paise, l.grade,
                 n.serial_digits, n.denomination,
                 (select m.storage_key from media m
                   where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb,
                 s.display_name as seller_name
            from ${table} c
            join listings l on l.id = c.listing_id
            join sellers s on s.id = l.seller_id
            left join notes n on n.listing_id = l.id
            ${frameJoin}
           where c.buyer_id = $1
           order by c.added_at desc
           limit 200`;
}

export function registerBasketRoutes(router: Router, _database: Database): void {
  /** GET /v1/cart */
  router.add('GET', '/v1/cart', async (ctx) => {
    const userId = requireUser(ctx);
    const rows = await ctx.db.query<BasketRow>(listQuery('cart_items'), [userId]);
    const items = rows.rows.map(shape);

    // Only what can actually be bought counts towards the total; a sold item
    // in the cart must not inflate what the buyer thinks they owe.
    const totalInr = items
      .filter((i) => i['available'] === true && typeof i['priceInr'] === 'number')
      .reduce((sum, i) => sum + (i['priceInr'] as number), 0);

    return json({
      items,
      count: items.length,
      availableCount: items.filter((i) => i['available'] === true).length,
      totalInr,
    });
  });

  /** POST /v1/cart — body: listingId. */
  router.add('POST', '/v1/cart', async (ctx) => {
    const userId = requireUser(ctx);
    const listingId = await listingFrom(ctx);

    const listing = await loadListing(ctx, listingId);
    if (listing === null) throw notFound('No such listing.');
    if (listing.seller_user_id === userId) {
      throw badRequest('This is your own listing.');
    }
    if (listing.state !== BUYABLE) {
      throw conflict('That item is no longer for sale.');
    }

    await ctx.db.query(
      `insert into cart_items (buyer_id, listing_id) values ($1, $2)
       on conflict (buyer_id, listing_id) do nothing`,
      [userId, listingId],
    );

    return json({ added: true, listingId }, 201);
  });

  /** DELETE /v1/cart/:listingId */
  router.add('DELETE', '/v1/cart/:listingId', async (ctx) => {
    const userId = requireUser(ctx);
    const listingId = ctx.params['listingId'] ?? '';
    await ctx.db.query(`delete from cart_items where buyer_id = $1 and listing_id = $2`, [
      userId,
      listingId,
    ]);
    return json({ removed: true });
  });

  /** GET /v1/saved */
  router.add('GET', '/v1/saved', async (ctx) => {
    const userId = requireUser(ctx);
    const rows = await ctx.db.query<BasketRow>(listQuery('saved_items'), [userId]);
    const items = rows.rows.map(shape);
    return json({
      items,
      count: items.length,
      availableCount: items.filter((i) => i['available'] === true).length,
    });
  });

  /** POST /v1/saved — body: listingId, optional note. */
  router.add('POST', '/v1/saved', async (ctx) => {
    const userId = requireUser(ctx);
    const fields = asObject(await ctx.body());
    const listingId = typeof fields['listingId'] === 'string' ? fields['listingId'] : '';
    if (!/^[0-9a-f-]{36}$/i.test(listingId)) {
      throw badRequest('A listing must be identified.', { listingId: 'invalid' });
    }
    const note = optionalString(fields, 'note', 500);

    const listing = await loadListing(ctx, listingId);
    if (listing === null) throw notFound('No such listing.');
    if (listing.seller_user_id === userId) throw badRequest('This is your own listing.');

    // Saving something already sold is allowed on purpose: a collector may want
    // to remember what a comparable note went for.
    await ctx.db.query(
      `insert into saved_items (buyer_id, listing_id, note) values ($1, $2, $3)
       on conflict (buyer_id, listing_id) do update set note = excluded.note`,
      [userId, listingId, note],
    );

    return json({ saved: true, listingId }, 201);
  });

  /** DELETE /v1/saved/:listingId */
  router.add('DELETE', '/v1/saved/:listingId', async (ctx) => {
    const userId = requireUser(ctx);
    const listingId = ctx.params['listingId'] ?? '';
    await ctx.db.query(`delete from saved_items where buyer_id = $1 and listing_id = $2`, [
      userId,
      listingId,
    ]);
    return json({ removed: true });
  });

  /**
   * POST /v1/saved/:listingId/to-cart — move a saved item into the cart.
   *
   * A single call rather than the client doing two, so a buyer cannot end up
   * with the item in neither list because the second request failed.
   */
  router.add('POST', '/v1/saved/:listingId/to-cart', async (ctx) => {
    const userId = requireUser(ctx);
    const listingId = ctx.params['listingId'] ?? '';

    const listing = await loadListing(ctx, listingId);
    if (listing === null) throw notFound('No such listing.');
    if (listing.state !== BUYABLE) throw conflict('That item is no longer for sale.');

    await ctx.db.query(
      `insert into cart_items (buyer_id, listing_id) values ($1, $2)
       on conflict (buyer_id, listing_id) do nothing`,
      [userId, listingId],
    );
    await ctx.db.query(`delete from saved_items where buyer_id = $1 and listing_id = $2`, [
      userId,
      listingId,
    ]);

    return json({ moved: true });
  });
}

function requireUser(ctx: Ctx): string {
  if (ctx.session === null) throw unauthorized();
  return ctx.session.userId;
}

async function listingFrom(ctx: Ctx): Promise<string> {
  const fields = asObject(await ctx.body());
  const listingId = typeof fields['listingId'] === 'string' ? fields['listingId'] : '';
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) {
    throw badRequest('A listing must be identified.', { listingId: 'invalid' });
  }
  return listingId;
}

async function loadListing(
  ctx: Ctx,
  listingId: string,
): Promise<{ state: string; seller_user_id: string } | null> {
  return one(
    await ctx.db.query<{ state: string; seller_user_id: string }>(
      `select l.state, s.user_id as seller_user_id
         from listings l join sellers s on s.id = l.seller_id
        where l.id = $1`,
      [listingId],
    ),
  );
}
