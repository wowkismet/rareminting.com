/**
 * The admin console's API.
 *
 * Every route here is gated on the `admin` role and writes an audit record for
 * anything it changes. Staff acting on someone else's listing or KYC is exactly
 * the activity that has to be reconstructable later, and `audit_logs` is
 * append-only at the database level rather than by convention.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString } from '../validate.ts';
import { one } from '../db.ts';

const KYC_STATES = ['pending', 'under_review', 'verified', 'rejected', 'suspended'] as const;
const LISTING_STATES = ['pending_review', 'minted', 'withdrawn', 'rejected'] as const;

/** The signed-in user's roles, or an empty list. */
async function rolesOf(ctx: Ctx, userId: string): Promise<string[]> {
  const result = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1`,
    [userId],
  );
  return result.rows.map((r) => r.role);
}

/**
 * Admin guard.
 *
 * Deliberately returns 404 rather than 403 to a signed-in non-admin: the
 * existence of the console is not something a curious buyer needs confirmed.
 */
async function requireAdmin(ctx: Ctx): Promise<string> {
  if (ctx.session === null) throw unauthorized();
  const roles = await rolesOf(ctx, ctx.session.userId);
  if (!roles.includes('admin')) throw notFound('Not found.');
  return ctx.session.userId;
}

async function audit(
  ctx: Ctx,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await ctx.db.query(
    `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                             before, after, ip, user_agent)
     values ($1::uuid, 'admin', $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet, $8)`,
    [
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(before),
      JSON.stringify(after),
      ctx.ip,
      ctx.userAgent,
    ],
  );
}

export function registerAdminRoutes(router: Router): void {
  /** GET /v1/admin/overview — the numbers the console opens on. */
  router.add('GET', '/v1/admin/overview', async (ctx) => {
    await requireAdmin(ctx);

    const counts = await ctx.db.query<Record<string, string>>(
      `select
         (select count(*) from users)::text                                    as users,
         (select count(*) from sellers)::text                                  as sellers,
         (select count(*) from sellers where kyc_state = 'pending')::text      as kyc_pending,
         (select count(*) from sellers where kyc_state = 'under_review')::text as kyc_review,
         (select count(*) from listings)::text                                 as listings,
         (select count(*) from listings where state = 'minted')::text          as listings_live,
         (select count(*) from listings where state = 'draft')::text           as listings_draft,
         (select count(*) from orders)::text                                   as orders,
         (select count(*) from review_queue
            where state in ('queued','assigned'))::text                        as review_open,
         (select count(*) from disputes
            where state not in ('closed','resolved_buyer','resolved_seller'))::text as disputes_open`,
    );

    const row = counts.rows[0] ?? {};
    const n = (k: string): number => Number(row[k] ?? 0);

    return json({
      users: n('users'),
      sellers: n('sellers'),
      kycPending: n('kyc_pending') + n('kyc_review'),
      listings: n('listings'),
      listingsLive: n('listings_live'),
      listingsDraft: n('listings_draft'),
      orders: n('orders'),
      reviewOpen: n('review_open'),
      disputesOpen: n('disputes_open'),
    });
  });

  /** GET /v1/admin/sellers — the KYC queue, oldest first. */
  router.add('GET', '/v1/admin/sellers', async (ctx) => {
    await requireAdmin(ctx);
    const state = ctx.url.searchParams.get('kycState');

    const rows = await ctx.db.query<{
      id: string;
      display_name: string;
      kind: string;
      kyc_state: string;
      is_minting_verified: boolean;
      gstin: string | null;
      email: string;
      created_at: string;
      listing_count: string;
    }>(
      `select s.id, s.display_name, s.kind, s.kyc_state, s.is_minting_verified,
              s.gstin, u.email, s.created_at::text as created_at,
              (select count(*) from listings l where l.seller_id = s.id)::text as listing_count
         from sellers s
         join users u on u.id = s.user_id
        where ($1::text is null or s.kyc_state = $1::kyc_state)
        order by s.created_at asc
        limit 100`,
      [state],
    );

    return json({
      sellers: rows.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        kind: r.kind,
        kycState: r.kyc_state,
        mintingVerified: r.is_minting_verified,
        gstin: r.gstin,
        email: r.email,
        listingCount: Number(r.listing_count),
        createdAt: r.created_at,
      })),
    });
  });

  /** POST /v1/admin/sellers/:id/kyc — decide a seller's verification. */
  router.add('POST', '/v1/admin/sellers/:id/kyc', async (ctx) => {
    const actorId = await requireAdmin(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const state = oneOf(fields, 'kycState', KYC_STATES);
    const reason = optionalString(fields, 'reason', 500);

    if (state === 'rejected' && reason === null) {
      throw badRequest('Give a reason when rejecting, so the seller knows what to fix.', {
        reason: 'required',
      });
    }

    const existing = await ctx.db.query<{ kyc_state: string }>(
      `select kyc_state from sellers where id = $1`,
      [id],
    );
    const before = one(existing);
    if (before === null) throw notFound('No such seller.');

    // Verification is what unlocks the badge and a higher listing limit.
    const verified = state === 'verified';
    await ctx.db.query(
      `update sellers
          set kyc_state = $2::kyc_state,
              kyc_verified_at = case when $3 then now() else null end,
              is_minting_verified = $3,
              listing_limit = case when $3 then greatest(listing_limit, 100) else listing_limit end
        where id = $1`,
      [id, state, verified],
    );

    await audit(ctx, actorId, 'seller.kyc', 'seller', id, before, {
      kyc_state: state,
      reason,
    });

    return json({ id, kycState: state, mintingVerified: verified });
  });

  /** GET /v1/admin/listings — moderation list. */
  router.add('GET', '/v1/admin/listings', async (ctx) => {
    await requireAdmin(ctx);
    const state = ctx.url.searchParams.get('state');

    const rows = await ctx.db.query<{
      id: string;
      title: string;
      state: string;
      price_paise: string | null;
      grade: string | null;
      seller_name: string;
      serial_digits: string | null;
      created_at: string;
    }>(
      `select l.id, l.title, l.state, l.price_paise::text as price_paise, l.grade,
              s.display_name as seller_name, n.serial_digits,
              l.created_at::text as created_at
         from listings l
         join sellers s on s.id = l.seller_id
         left join notes n on n.listing_id = l.id
        where ($1::text is null or l.state = $1::listing_state)
        order by l.created_at desc
        limit 100`,
      [state],
    );

    return json({
      listings: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        state: r.state,
        priceInr: r.price_paise === null ? null : Number(r.price_paise) / 100,
        grade: r.grade,
        sellerName: r.seller_name,
        serialDigits: r.serial_digits,
        createdAt: r.created_at,
      })),
    });
  });

  /** POST /v1/admin/listings/:id/state — moderate a listing. */
  router.add('POST', '/v1/admin/listings/:id/state', async (ctx) => {
    const actorId = await requireAdmin(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const state = oneOf(fields, 'state', LISTING_STATES);
    const reason = optionalString(fields, 'reason', 500);

    const existing = await ctx.db.query<{ state: string }>(
      `select state from listings where id = $1`,
      [id],
    );
    const before = one(existing);
    if (before === null) throw notFound('No such listing.');

    await ctx.db.query(
      `update listings
          set state = $2::listing_state,
              published_at = case when $2 = 'minted' then coalesce(published_at, now())
                                  else published_at end
        where id = $1`,
      [id, state],
    );

    await audit(ctx, actorId, 'listing.moderate', 'listing', id, before, { state, reason });

    return json({ id, state });
  });

  /** GET /v1/admin/audit — the trail, newest first. */
  router.add('GET', '/v1/admin/audit', async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query<{
      action: string;
      entity_type: string;
      entity_id: string | null;
      created_at: string;
      email: string | null;
    }>(
      `select a.action, a.entity_type, a.entity_id, a.created_at::text as created_at,
              u.email
         from audit_logs a
         left join users u on u.id = a.actor_id
        order by a.created_at desc
        limit 100`,
    );

    return json({ entries: rows.rows });
  });
}
