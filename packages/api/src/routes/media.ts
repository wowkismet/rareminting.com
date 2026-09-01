/**
 * Photographs of a note.
 *
 * Uploads are written to disk outside the release directory, so a deploy that
 * prunes old releases can never take a seller's photographs with it. Nginx
 * serves them directly; the API only writes them.
 *
 * The file is trusted only as far as its bytes go:
 *
 *  - the declared content-type is ignored in favour of the actual magic bytes,
 *    because a script renamed to .jpg will happily claim to be an image
 *  - the stored filename is generated here, never taken from the upload, so a
 *    name like `../../etc/cron.d/x` cannot escape the directory
 *  - the extension is derived from the detected type, not the submitted one
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.ts';
import { one } from '../db.ts';

const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? '/srv/rareminting/uploads';
const PUBLIC_PREFIX = '/media';
const MAX_BYTES = 10 * 1024 * 1024;

const MEDIA_KINDS = ['obverse', 'reverse', 'detail', 'uv'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

interface Detected {
  readonly contentType: string;
  readonly extension: string;
}

/**
 * Identify an image by its leading bytes.
 *
 * Returns null for anything not recognised — including a file that merely
 * claims to be an image.
 */
function detectImage(bytes: Uint8Array): Detected | null {
  if (bytes.length < 12) return null;

  const startsWith = (...sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);

  if (startsWith(0xff, 0xd8, 0xff)) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { contentType: 'image/png', extension: 'png' };
  }
  // RIFF....WEBP
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

/** The listing, if the signed-in user is the seller who owns it. */
async function ownedListing(ctx: Ctx, listingId: string): Promise<{ id: string } | null> {
  if (ctx.session === null) throw unauthorized();

  const result = await ctx.db.query<{ id: string }>(
    `select l.id
       from listings l
       join sellers s on s.id = l.seller_id
      where l.id = $1 and s.user_id = $2`,
    [listingId, ctx.session.userId],
  );
  return one(result);
}

export function registerMediaRoutes(router: Router): void {
  /** POST /v1/listings/:id/media — upload one photograph. */
  router.add('POST', '/v1/listings/:id/media', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const listingId = ctx.params['id'] ?? '';

    const exists = await ctx.db.query<{ id: string }>(`select id from listings where id = $1`, [
      listingId,
    ]);
    if (one(exists) === null) throw notFound('No such listing.');
    if ((await ownedListing(ctx, listingId)) === null) {
      throw forbidden('This listing belongs to another seller.');
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

    const kindValue = form.get('kind');
    const kind: MediaKind =
      typeof kindValue === 'string' && (MEDIA_KINDS as readonly string[]).includes(kindValue)
        ? (kindValue as MediaKind)
        : 'obverse';

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImage(bytes);
    if (detected === null) {
      throw badRequest('That does not look like a JPEG, PNG or WebP image.');
    }

    // Name generated here; nothing from the upload reaches the filesystem.
    const id = randomUUID();
    const storageKey = `${listingId}/${id}.${detected.extension}`;
    const target = path.join(UPLOAD_DIR, storageKey);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);

    const inserted = await ctx.db.query<{ id: string; sort_order: number }>(
      `insert into media (listing_id, kind, storage_key, content_type, bytes, sort_order)
       values ($1, $2::media_kind, $3, $4, $5,
               coalesce((select max(sort_order) + 1 from media where listing_id = $1), 0))
       returning id, sort_order`,
      [listingId, kind, storageKey, detected.contentType, bytes.length],
    );

    const row = inserted.rows[0];
    if (row === undefined) throw new Error('failed to record media');

    return json(
      {
        media: {
          id: row.id,
          kind,
          url: `${PUBLIC_PREFIX}/${storageKey}`,
          contentType: detected.contentType,
          bytes: bytes.length,
          sortOrder: row.sort_order,
        },
      },
      201,
    );
  });

  /** GET /v1/listings/:id/media — the photographs for a listing. */
  router.add('GET', '/v1/listings/:id/media', async (ctx) => {
    const listingId = ctx.params['id'] ?? '';

    const rows = await ctx.db.query<{
      id: string;
      kind: string;
      storage_key: string;
      content_type: string | null;
      sort_order: number;
    }>(
      `select id, kind, storage_key, content_type, sort_order
         from media where listing_id = $1 order by sort_order asc`,
      [listingId],
    );

    return json({
      media: rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        url: `${PUBLIC_PREFIX}/${r.storage_key}`,
        contentType: r.content_type,
        sortOrder: r.sort_order,
      })),
    });
  });
}
