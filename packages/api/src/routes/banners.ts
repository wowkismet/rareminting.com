/**
 * Promotional banners.
 *
 * A slot is a named position rather than a page path, so a banner survives the
 * page being restructured and cannot be aimed at a route that does not exist.
 *
 * Scheduling is a window rather than a switch. "Up until Diwali" is what
 * somebody actually wants, and a flag they have to remember to turn off is how
 * a Republic Day banner is still up in March.
 *
 * The public read is deliberately anonymous and cheap: it is on the homepage,
 * so it must not need a session and must not do work per visitor.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, notFound, unauthorized } from '../errors.ts';
import { one, type Database } from '../db.ts';

/** Banner images are public by design, so they live with the listing photos. */
const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? '/srv/rareminting/uploads';
const MAX_BYTES = 4 * 1024 * 1024;

const SLOTS = ['home_hero', 'home_mid', 'listing_page', 'cart', 'browse'] as const;
type Slot = (typeof SLOTS)[number];

function detect(bytes: Uint8Array): { extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return { extension: 'png' };
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42
  ) {
    return { extension: 'webp' };
  }
  return null;
}

/**
 * Somewhere on this site, and nowhere else.
 *
 * A banner is written by staff, but an open redirect is an open redirect
 * however trusted the person typing it — and a promotional link is exactly
 * what gets copied into an email.
 */
function safeHref(value: string | null): string | null {
  if (value === null) return null;
  const href = value.trim();
  if (href === '') return null;
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  return href.slice(0, 300);
}

async function isStaff(ctx: Ctx, userId: string): Promise<boolean> {
  const roles = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 and role = 'admin'`,
    [userId],
  );
  return roles.rows.length > 0;
}

interface BannerRow {
  id: string;
  slot: string;
  headline: string;
  subtext: string | null;
  href: string | null;
  cta_label: string | null;
  storage_key: string | null;
  alt_text: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

const shape = (r: BannerRow): Record<string, unknown> => ({
  id: r.id,
  slot: r.slot,
  headline: r.headline,
  subtext: r.subtext,
  href: r.href,
  ctaLabel: r.cta_label,
  imageUrl: r.storage_key === null ? null : `/media/${r.storage_key}`,
  altText: r.alt_text,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
});

export function registerBannerRoutes(router: Router, _database: Database): void {
  /**
   * GET /v1/banners?slot=home_hero — what is live in a slot, right now.
   *
   * No session needed. The window is evaluated in the database rather than in
   * the caller, so every page agrees on what "live" means.
   */
  router.add('GET', '/v1/banners', async (ctx: Ctx) => {
    const slot = ctx.url.searchParams.get('slot');
    if (slot !== null && !(SLOTS as readonly string[]).includes(slot)) {
      throw badRequest('Unknown slot.', { slot: 'unknown' });
    }

    const rows = await ctx.db.query<BannerRow>(
      `select id, slot::text as slot, headline, subtext, href, cta_label, storage_key,
              alt_text, sort_order, is_active,
              starts_at::text as starts_at, ends_at::text as ends_at
         from banners
        where is_active = true
          and (starts_at is null or starts_at <= now())
          and (ends_at   is null or ends_at   >  now())
          and ($1::text is null or slot = $1::banner_slot)
        order by sort_order asc, created_at desc`,
      [slot],
    );

    return json({ banners: rows.rows.map(shape) });
  });

  /** GET /v1/admin/banners — every banner, live or not. */
  router.add('GET', '/v1/admin/banners', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    if (!(await isStaff(ctx, ctx.session.userId))) throw notFound('Not found.');

    const rows = await ctx.db.query<BannerRow>(
      `select id, slot::text as slot, headline, subtext, href, cta_label, storage_key,
              alt_text, sort_order, is_active,
              starts_at::text as starts_at, ends_at::text as ends_at
         from banners order by slot, sort_order asc, created_at desc`,
    );
    return json({ banners: rows.rows.map(shape), slots: SLOTS });
  });

  /** POST /v1/admin/banners — put one up. Multipart, image optional. */
  router.add('POST', '/v1/admin/banners', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    if (!(await isStaff(ctx, userId))) throw notFound('Not found.');

    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw badRequest('Send the banner as multipart form data.');
    }

    const str = (key: string): string | null => {
      const v = form.get(key);
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    };

    const slotValue = form.get('slot');
    if (typeof slotValue !== 'string' || !(SLOTS as readonly string[]).includes(slotValue)) {
      throw badRequest(`Choose a slot: ${SLOTS.join(', ')}.`, { slot: 'unknown' });
    }
    const slot = slotValue as Slot;

    const headline = str('headline');
    if (headline === null) {
      throw badRequest('A banner needs a headline — it is what somebody reads.', {
        headline: 'required',
      });
    }

    const altText = str('altText');
    let storageKey: string | null = null;

    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) {
        throw badRequest(`Banner images must be ${MAX_BYTES / 1024 / 1024} MB or smaller.`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const detected = detect(bytes);
      if (detected === null) throw badRequest('That must be a JPEG, PNG or WebP.');

      if (altText === null) {
        throw badRequest(
          'Describe the image for somebody who cannot see it. This is the one place the words are ours to write.',
          { altText: 'required' },
        );
      }

      const id = randomUUID();
      storageKey = `banners/${id}.${detected.extension}`;
      const target = path.join(UPLOAD_DIR, storageKey);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }

    const created = await ctx.db.query<{ id: string }>(
      `insert into banners
         (slot, headline, subtext, href, cta_label, storage_key, alt_text,
          sort_order, starts_at, ends_at, created_by)
       values ($1::banner_slot, $2, $3, $4, $5, $6, $7,
               coalesce($8, 0), $9, $10, $11::uuid)
       returning id`,
      [
        slot,
        headline,
        str('subtext'),
        safeHref(str('href')),
        str('ctaLabel'),
        storageKey,
        altText,
        Number(str('sortOrder') ?? '0') || 0,
        str('startsAt'),
        str('endsAt'),
        userId,
      ],
    );

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'banner.create', 'banner', $2, $3::jsonb, $4::inet, $5)`,
      [userId, created.rows[0]!.id, JSON.stringify({ slot, headline }), ctx.ip, ctx.userAgent],
    );

    return json({ banner: { id: created.rows[0]!.id, slot } }, 201);
  });

  /** PATCH /v1/admin/banners/:id — take one down, or change when it runs. */
  router.add('PATCH', '/v1/admin/banners/:id', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    if (!(await isStaff(ctx, userId))) throw notFound('Not found.');

    const id = ctx.params['id'] ?? '';
    const before = one(
      await ctx.db.query<{ is_active: boolean; headline: string }>(
        `select is_active, headline from banners where id = $1`,
        [id],
      ),
    );
    if (before === null) throw notFound('No such banner.');

    const fields = (await ctx.body()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if ('isActive' in fields) patch['is_active'] = fields['isActive'] === true;
    if ('sortOrder' in fields) {
      const n = Number(fields['sortOrder']);
      if (!Number.isInteger(n) || n < 0) throw badRequest('Sort order must be a whole number.');
      patch['sort_order'] = n;
    }
    if ('headline' in fields) {
      const h = String(fields['headline'] ?? '').trim();
      if (h === '') throw badRequest('A banner needs a headline.', { headline: 'required' });
      patch['headline'] = h.slice(0, 200);
    }
    if ('endsAt' in fields) patch['ends_at'] = fields['endsAt'] === null ? null : String(fields['endsAt']);
    if (Object.keys(patch).length === 0) throw badRequest('Nothing to change.');

    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`);
    await ctx.db.query(`update banners set ${sets.join(', ')} where id = $1`, [
      id,
      ...Object.values(patch),
    ]);

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, before, after, ip, user_agent)
       values ($1::uuid, 'admin', 'banner.edit', 'banner', $2, $3::jsonb, $4::jsonb, $5::inet, $6)`,
      [userId, id, JSON.stringify(before), JSON.stringify(patch), ctx.ip, ctx.userAgent],
    );

    return json({ id, ...patch });
  });

  /** DELETE /v1/admin/banners/:id — remove it entirely. */
  router.add('DELETE', '/v1/admin/banners/:id', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    if (!(await isStaff(ctx, userId))) throw notFound('Not found.');

    const id = ctx.params['id'] ?? '';
    const before = one(
      await ctx.db.query<{ headline: string; slot: string }>(
        `select headline, slot::text as slot from banners where id = $1`,
        [id],
      ),
    );
    if (before === null) throw notFound('No such banner.');

    await ctx.db.query(`delete from banners where id = $1`, [id]);
    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, before, ip, user_agent)
       values ($1::uuid, 'admin', 'banner.delete', 'banner', $2, $3::jsonb, $4::inet, $5)`,
      [userId, id, JSON.stringify(before), ctx.ip, ctx.userAgent],
    );

    return json({ removed: id });
  });
}
