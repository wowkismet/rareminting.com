/**
 * Frames, and the personalisation that goes in them.
 *
 * A frame belongs to one note rather than to a basket, so everything here is
 * addressed by the listing it is attached to. Two notes in the same order can
 * take different frames, photographs and messages.
 *
 * The photograph is the reason this file is careful. A listing's photograph is
 * public — it is how the note is sold. A customer's family photograph is not,
 * and it must never land in `uploads/`, which nginx serves at /media/ with no
 * authentication at all. It goes beside the KYC documents instead, outside
 * anything nginx can reach, and comes back only through the route at the foot
 * of this file, which checks who is asking.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, optionalString } from '../validate.ts';
import { one } from '../db.ts';

/**
 * Outside the web root, like the KYC store. Never served by nginx.
 *
 * Read on each call rather than captured at import, so a test can point it at
 * a temporary directory after the module is already loaded — imports are
 * hoisted, so anything captured here would be fixed before a test file's
 * first line ever runs.
 */
function giftDir(): string {
  return process.env['GIFT_DIR'] ?? '/srv/rareminting/gifts';
}
const MAX_BYTES = 8 * 1024 * 1024;

/** Length caps that match what the frames can physically hold. */
const LIMITS = { message: 400, recipient: 80, sender: 80 } as const;

interface Detected {
  readonly contentType: string;
  readonly extension: string;
}

/** Identify an image by its leading bytes; the declared type is not trusted. */
function detectImage(bytes: Uint8Array): Detected | null {
  if (bytes.length < 12) return null;
  const at = (...sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);

  if (at(0xff, 0xd8, 0xff)) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (at(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (
    at(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

/** The cart line this buyer owns, or null. */
async function ownedLine(ctx: Ctx, listingId: string): Promise<{ listing_id: string } | null> {
  if (ctx.session === null) throw unauthorized();
  return one(
    await ctx.db.query<{ listing_id: string }>(
      `select listing_id from cart_items where buyer_id = $1 and listing_id = $2`,
      [ctx.session.userId, listingId],
    ),
  );
}

export function registerFrameRoutes(router: Router): void {
  /**
   * GET /v1/frames — the frames on offer.
   *
   * Public and anonymous: the picker is shown on a listing before anybody has
   * signed in, and knowing which frames exist is not privileged.
   */
  router.add('GET', '/v1/frames', async (ctx) => {
    const rows = await ctx.db.query<{
      id: string;
      code: string;
      name: string;
      orientation: string;
      price_paise: string;
    }>(
      `select id, code, name, orientation, price_paise::text as price_paise
         from frame_templates
        where is_active = true
        order by sort_order asc, name asc`,
    );

    return json({
      frames: rows.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        orientation: r.orientation,
        priceInr: Number(r.price_paise) / 100,
      })),
    });
  });

  /**
   * PUT /v1/cart/:listingId/frame — choose a frame and write the card.
   *
   * One call rather than several, because a half-personalised frame is not a
   * state worth storing: the buyer either wants this frame with these words
   * or they do not. The photograph is uploaded separately, since a file
   * cannot ride along in JSON.
   */
  router.add('PUT', '/v1/cart/:listingId/frame', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['listingId'] ?? '';

    if ((await ownedLine(ctx, listingId)) === null) {
      throw notFound('That item is not in your cart.');
    }

    const fields = asObject(await ctx.body());
    const code = optionalString(fields, 'frameCode', 60);
    if (code === null || code === '') {
      throw badRequest('Choose a frame.', { frameCode: 'required' });
    }

    const frame = one(
      await ctx.db.query<{ id: string }>(
        `select id from frame_templates where code = $1 and is_active = true`,
        [code],
      ),
    );
    if (frame === null) throw badRequest('No such frame.', { frameCode: 'unknown' });

    const message = optionalString(fields, 'message', LIMITS.message);
    const recipient = optionalString(fields, 'recipient', LIMITS.recipient);
    const sender = optionalString(fields, 'sender', LIMITS.sender);

    // A date the buyer is marking — a birthday, an anniversary. Stored as a
    // date rather than text so it can be formatted day-first like every other
    // date on the site rather than however they happened to type it.
    const occasionRaw = optionalString(fields, 'occasionOn', 10);
    if (occasionRaw !== null && occasionRaw !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(occasionRaw)) {
      throw badRequest('That is not a date.', { occasionOn: 'invalid' });
    }

    await ctx.db.query(
      `update cart_items
          set frame_template_id = $3,
              frame_message     = $4,
              frame_recipient   = $5,
              frame_sender      = $6,
              frame_occasion_on = $7::date
        where buyer_id = $1 and listing_id = $2`,
      [
        ctx.session.userId,
        listingId,
        frame.id,
        message,
        recipient,
        sender,
        occasionRaw === '' ? null : occasionRaw,
      ],
    );

    return json({ framed: listingId, frameCode: code });
  });

  /** DELETE /v1/cart/:listingId/frame — sell the note without a frame after all. */
  router.add('DELETE', '/v1/cart/:listingId/frame', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['listingId'] ?? '';

    // The photograph's row reference goes; the file on disk is left, because
    // a buyer who changes their mind twice should not have to upload it
    // again, and it is unreachable without the row that names it.
    const cleared = await ctx.db.query<{ listing_id: string }>(
      `update cart_items
          set frame_template_id = null, frame_message = null,
              frame_recipient = null, frame_sender = null, frame_occasion_on = null
        where buyer_id = $1 and listing_id = $2
        returning listing_id`,
      [ctx.session.userId, listingId],
    );
    if (cleared.rows.length === 0) throw notFound('That item is not in your cart.');

    return json({ cleared: listingId });
  });

  /**
   * POST /v1/cart/:listingId/frame/photo — the photograph for the frame.
   *
   * Written outside the public uploads directory. The stored name is generated
   * here and the extension comes from the detected type, so nothing the
   * uploader sends reaches the filesystem.
   */
  router.add('POST', '/v1/cart/:listingId/frame/photo', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['listingId'] ?? '';

    if ((await ownedLine(ctx, listingId)) === null) {
      throw notFound('That item is not in your cart.');
    }

    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw badRequest('Send the photograph as multipart form data.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) throw badRequest('Attach a photograph in the "file" field.');
    if (file.size === 0) throw badRequest('That file is empty.');
    if (file.size > MAX_BYTES) {
      throw badRequest(`Photographs must be ${MAX_BYTES / 1024 / 1024} MB or smaller.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (detected === null) {
      throw badRequest('That does not look like a JPEG, PNG or WebP image.');
    }

    // Keyed by buyer so one person's gift photographs sit together, and so a
    // stray key from another account cannot be read by the route below.
    const key = `${ctx.session.userId}/${randomUUID()}.${detected.extension}`;
    const target = path.join(giftDir(), key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    await ctx.db.query(
      `update cart_items set frame_photo_key = $3 where buyer_id = $1 and listing_id = $2`,
      [ctx.session.userId, listingId, key],
    );

    return json({ photo: { key, contentType: detected.contentType, bytes: bytes.length } }, 201);
  });

  /**
   * GET /v1/gift-photo/:key — the photograph back, for the buyer who sent it.
   *
   * The key begins with the owner's user id, and that is checked against the
   * session rather than trusted: without this, a key guessed or copied from
   * somewhere else would return somebody's family photograph. Staff are not
   * given a way in here either — there is no support reason to look.
   */
  router.add('GET', '/v1/gift-photo/:owner/:name', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const owner = ctx.params['owner'] ?? '';
    const name = ctx.params['name'] ?? '';

    if (owner !== ctx.session.userId) throw forbidden('That photograph is not yours.');
    // Nothing but a generated name is acceptable: no separators, no dots
    // beyond the single extension, so no path can be built out of it.
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) throw notFound('No such photograph.');

    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(giftDir(), owner, name));
    } catch {
      throw notFound('No such photograph.');
    }

    const type = name.endsWith('.png')
      ? 'image/png'
      : name.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': type,
        // Private to one person, so no shared cache may keep a copy.
        'cache-control': 'private, max-age=300',
      },
    });
  });
}
