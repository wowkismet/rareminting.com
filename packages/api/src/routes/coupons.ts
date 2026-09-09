/**
 * Coupons: staff make them, buyers spend them.
 *
 * The check and the redemption are separate on purpose. A buyer typing a code
 * at checkout wants to know immediately whether it works and what it takes
 * off; the redemption happens once, inside the transaction that creates the
 * order, under a lock — so two people cannot spend the last one at the same
 * moment.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, notFound, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';
import { computeDiscount, type CouponRule } from '../charges.ts';

const KINDS = ['percent', 'fixed'] as const;

export interface CouponRow {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  max_discount_paise: string | null;
  min_order_paise: string;
  usage_limit: number | null;
  used_count: number;
  per_buyer_limit: number;
}

const ruleOf = (c: CouponRow): CouponRule => ({
  kind: c.kind,
  value: c.value,
  maxDiscountPaise: c.max_discount_paise === null ? null : Number(c.max_discount_paise),
  minOrderPaise: Number(c.min_order_paise),
});

/**
 * Find a live coupon and say what it would take off, or why it would not.
 *
 * Every refusal names its reason. "Invalid coupon" sends somebody to support;
 * "this one starts on Friday" does not.
 */
export async function checkCoupon(
  ctx: Ctx,
  code: string,
  buyerId: string,
  subtotalPaise: number,
): Promise<{ ok: true; coupon: CouponRow; discountPaise: number } | { ok: false; reason: string }> {
  const found = one(
    await ctx.db.query<CouponRow & { starts_at: string | null; ends_at: string | null; is_active: boolean }>(
      `select id, code, kind::text as kind, value, max_discount_paise::text as max_discount_paise,
              min_order_paise::text as min_order_paise, usage_limit, used_count, per_buyer_limit,
              is_active, starts_at::text as starts_at, ends_at::text as ends_at
         from coupons where upper(code) = upper($1)`,
      [code],
    ),
  );

  if (found === null) return { ok: false, reason: 'That code does not exist. Check the spelling.' };
  if (!found.is_active) return { ok: false, reason: 'That code is no longer being offered.' };

  const now = Date.now();
  if (found.starts_at !== null && new Date(found.starts_at).getTime() > now) {
    return { ok: false, reason: `That code does not start until ${found.starts_at.slice(0, 10)}.` };
  }
  if (found.ends_at !== null && new Date(found.ends_at).getTime() <= now) {
    return { ok: false, reason: `That code expired on ${found.ends_at.slice(0, 10)}.` };
  }
  if (found.usage_limit !== null && found.used_count >= found.usage_limit) {
    return { ok: false, reason: 'That code has been fully claimed.' };
  }

  const mine = await ctx.db.query<{ n: string }>(
    `select count(*)::text as n from coupon_redemptions
      where coupon_id = $1 and buyer_id = $2`,
    [found.id, buyerId],
  );
  if (Number(mine.rows[0]?.n ?? 0) >= found.per_buyer_limit) {
    return { ok: false, reason: 'You have already used that code.' };
  }

  const minimum = Number(found.min_order_paise);
  if (subtotalPaise < minimum) {
    return {
      ok: false,
      reason: `That code needs a basket of at least ₹${(minimum / 100).toLocaleString('en-IN')}.`,
    };
  }

  const discountPaise = computeDiscount(ruleOf(found), subtotalPaise);
  if (discountPaise <= 0) {
    return { ok: false, reason: 'That code takes nothing off this basket.' };
  }

  return { ok: true, coupon: found, discountPaise };
}

export function registerCouponRoutes(router: Router, _database: Database): void {
  /**
   * POST /v1/coupons/check — would this code work, and for how much?
   *
   * Checks against the caller's own cart, so a code cannot be tested against
   * a basket they do not have.
   */
  router.add('POST', '/v1/coupons/check', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const fields = asObject(await ctx.body());
    const code = requiredString(fields, 'code', 32);

    const cart = await ctx.db.query<{ subtotal: string }>(
      `select coalesce(sum(l.price_paise), 0)::text as subtotal
         from cart_items c join listings l on l.id = c.listing_id
        where c.buyer_id = $1 and l.state = 'minted'`,
      [ctx.session.userId],
    );
    const subtotal = Number(cart.rows[0]?.subtotal ?? 0);

    const result = await checkCoupon(ctx, code, ctx.session.userId, subtotal);
    if (!result.ok) return json({ valid: false, reason: result.reason });

    return json({
      valid: true,
      code: result.coupon.code,
      discountInr: result.discountPaise / 100,
    });
  });

  /** GET /v1/admin/coupons — every coupon, spent or not. */
  router.add('GET', '/v1/admin/coupons', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const staff = await ctx.db.query<{ role: string }>(
      `select role from user_roles where user_id = $1 and role = 'admin'`,
      [ctx.session.userId],
    );
    if (staff.rows.length === 0) throw notFound('Not found.');

    const rows = await ctx.db.query<
      CouponRow & {
        description: string | null;
        is_active: boolean;
        starts_at: string | null;
        ends_at: string | null;
        given_paise: string;
      }
    >(
      `select c.id, c.code, c.description, c.kind::text as kind, c.value,
              c.max_discount_paise::text as max_discount_paise,
              c.min_order_paise::text as min_order_paise,
              c.usage_limit, c.used_count, c.per_buyer_limit, c.is_active,
              c.starts_at::text as starts_at, c.ends_at::text as ends_at,
              (select coalesce(sum(r.discount_paise), 0)::text
                 from coupon_redemptions r where r.coupon_id = c.id) as given_paise
         from coupons c order by c.created_at desc`,
    );

    return json({
      coupons: rows.rows.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        kind: c.kind,
        /** Percentage for a percent coupon, rupees for a fixed one. */
        value: c.kind === 'percent' ? c.value / 100 : c.value / 100,
        maxDiscountInr: c.max_discount_paise === null ? null : Number(c.max_discount_paise) / 100,
        minOrderInr: Number(c.min_order_paise) / 100,
        usageLimit: c.usage_limit,
        usedCount: c.used_count,
        perBuyerLimit: c.per_buyer_limit,
        isActive: c.is_active,
        startsAt: c.starts_at,
        endsAt: c.ends_at,
        /** What it has actually cost, which is the number that matters. */
        givenAwayInr: Number(c.given_paise) / 100,
      })),
    });
  });

  /** POST /v1/admin/coupons — make one. */
  router.add('POST', '/v1/admin/coupons', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const staff = await ctx.db.query<{ role: string }>(
      `select role from user_roles where user_id = $1 and role = 'admin'`,
      [userId],
    );
    if (staff.rows.length === 0) throw notFound('Not found.');

    const fields = asObject(await ctx.body());
    const code = requiredString(fields, 'code', 32).toUpperCase().trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
      throw badRequest(
        'A code is 3 to 32 characters: letters, numbers, hyphens and underscores.',
        { code: 'invalid' },
      );
    }

    const kind = oneOf(fields, 'kind', KINDS);

    const num = (key: string): number => {
      const n = Number(fields[key]);
      if (!Number.isFinite(n)) throw badRequest(`${key} must be a number.`, { [key]: 'invalid' });
      return n;
    };

    // A percentage arrives as a percentage and is stored in basis points; a
    // fixed amount arrives in rupees and is stored in paise. Neither is ever
    // held as a float.
    const value =
      kind === 'percent' ? Math.round(num('value') * 100) : Math.round(num('value') * 100);
    if (value <= 0) throw badRequest('The value must be above zero.', { value: 'invalid' });
    if (kind === 'percent' && value > 10_000) {
      throw badRequest('A percentage cannot be more than 100.', { value: 'invalid' });
    }

    const maxDiscount =
      'maxDiscountInr' in fields && fields['maxDiscountInr'] !== null
        ? Math.round(num('maxDiscountInr') * 100)
        : null;

    // Refused rather than defaulted: a percentage coupon with no ceiling is an
    // open cheque against the most expensive note in the shop, and the person
    // creating it should have to decide the number.
    if (kind === 'percent' && maxDiscount === null) {
      throw badRequest(
        'A percentage coupon needs a maximum discount. Without one it is unlimited against your most expensive listing.',
        { maxDiscountInr: 'required' },
      );
    }

    const minOrder = 'minOrderInr' in fields ? Math.round(num('minOrderInr') * 100) : 0;
    const usageLimit =
      'usageLimit' in fields && fields['usageLimit'] !== null ? Math.round(num('usageLimit')) : null;
    const perBuyer = 'perBuyerLimit' in fields ? Math.round(num('perBuyerLimit')) : 1;

    const clash = one(
      await ctx.db.query<{ id: string }>(`select id from coupons where upper(code) = $1`, [code]),
    );
    if (clash !== null) throw conflict(`${code} already exists.`);

    const created = await ctx.db.query<{ id: string }>(
      `insert into coupons
         (code, description, kind, value, max_discount_paise, min_order_paise,
          usage_limit, per_buyer_limit, starts_at, ends_at, created_by)
       values ($1, $2, $3::coupon_kind, $4, $5, $6, $7, $8, $9, $10, $11::uuid)
       returning id`,
      [
        code,
        optionalString(fields, 'description', 200),
        kind,
        value,
        maxDiscount,
        minOrder,
        usageLimit,
        Math.max(perBuyer, 1),
        optionalString(fields, 'startsAt', 40),
        optionalString(fields, 'endsAt', 40),
        userId,
      ],
    );

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'coupon.create', 'coupon', $2, $3::jsonb, $4::inet, $5)`,
      [userId, created.rows[0]!.id, JSON.stringify({ code, kind, value }), ctx.ip, ctx.userAgent],
    );

    return json({ coupon: { id: created.rows[0]!.id, code } }, 201);
  });

  /** PATCH /v1/admin/coupons/:id — stop one, or start it again. */
  router.add('PATCH', '/v1/admin/coupons/:id', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const staff = await ctx.db.query<{ role: string }>(
      `select role from user_roles where user_id = $1 and role = 'admin'`,
      [userId],
    );
    if (staff.rows.length === 0) throw notFound('Not found.');

    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    if (!('isActive' in fields)) throw badRequest('Nothing to change.', { body: 'empty' });

    const updated = await ctx.db.query<{ id: string; is_active: boolean }>(
      `update coupons set is_active = $2 where id = $1 returning id, is_active`,
      [id, fields['isActive'] === true],
    );
    if (updated.rows.length === 0) throw notFound('No such coupon.');

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'coupon.state', 'coupon', $2, $3::jsonb, $4::inet, $5)`,
      [userId, id, JSON.stringify({ isActive: updated.rows[0]!.is_active }), ctx.ip, ctx.userAgent],
    );

    return json({ id, isActive: updated.rows[0]!.is_active });
  });
}
