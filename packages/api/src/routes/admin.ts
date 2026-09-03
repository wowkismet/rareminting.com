/**
 * The admin console's API.
 *
 * Every route here is gated on the `admin` role and writes an audit record for
 * anything it changes. Staff acting on someone else's listing or KYC is exactly
 * the activity that has to be reconstructable later, and `audit_logs` is
 * append-only at the database level rather than by convention.
 */

import { maskMobile } from '@rareminting/config';

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
  /** GET /v1/admin/overview — comprehensive dashboard data. */
  router.add('GET', '/v1/admin/overview', async (ctx) => {
    await requireAdmin(ctx);

    // KPIs and counts
    const counts = await ctx.db.query<Record<string, string>>(
      `select
         (select count(*) from users)::text                                    as users,
         (select count(*) from sellers)::text                                  as sellers,
         (select count(*) from listings)::text                                 as products,
         (select count(*) from listings where state = 'minted')::text          as listings_live,
         (select count(*) from listings where state = 'draft')::text           as listings_draft,
         (select count(*) from orders)::text                                   as orders,
         (select count(*) from sellers where kyc_state = 'pending')::text      as kyc_pending,
         (select count(*) from sellers where kyc_state = 'under_review')::text as kyc_review,
         (select count(*) from review_queue
            where state in ('queued','assigned'))::text                        as review_open,
         (select count(*) from disputes
            where state not in ('closed','resolved_buyer','resolved_seller'))::text as disputes_open`,
    );

    // Financial metrics.
    //
    // Revenue is the commission actually recorded on each order, not the rate
    // applied to the total after the fact: the rate has changed once already,
    // and orders written under the old one must keep the figure they were
    // charged.
    const financial = await ctx.db.query<{ gmv: string; revenue: string }>(
      `select
         coalesce(sum(total_paise), 0)::text                                as gmv,
         coalesce(sum(commission_paise + gst_on_commission_paise), 0)::text as revenue
         from orders where state not in ('cancelled','refunded')`,
    );

    // Thirty days against the thirty before. Computed, not chosen — a platform
    // console is exactly where an encouraging invented percentage does damage.
    const trend = await ctx.db.query<Record<string, string>>(
      `select
         coalesce(sum(total_paise) filter (
           where created_at >= current_date - interval '29 days'), 0)::text as gmv_now,
         coalesce(sum(total_paise) filter (
           where created_at >= current_date - interval '59 days'
             and created_at <  current_date - interval '29 days'), 0)::text as gmv_prev,
         count(*) filter (
           where created_at >= current_date - interval '29 days')::text as orders_now,
         count(*) filter (
           where created_at >= current_date - interval '59 days'
             and created_at <  current_date - interval '29 days')::text as orders_prev
         from orders where state not in ('cancelled','refunded')`,
    );

    // Sales series (last 30 days for chart)
    const series = await ctx.db.query<{ day: string; gmv: string }>(
      `select d.day::date::text as day,
              coalesce(sum(o.total_paise), 0)::text as gmv
         from generate_series(current_date - interval '29 days', current_date, interval '1 day') d(day)
         left join orders o
           on o.created_at::date = d.day::date
          and o.state not in ('cancelled', 'refunded')
        group by d.day
        order by d.day`,
    );

    // Category breakdown
    const categories = await ctx.db.query<{ kind: string; gmv: string; count: string }>(
      `select l.kind, coalesce(sum(o.total_paise), 0)::text as gmv,
              count(distinct o.id)::text as count
         from listings l
         left join orders o on o.listing_id = l.id
                           and o.state not in ('cancelled','refunded')
        group by l.kind
        order by gmv desc`,
    );

    // Recent orders
    const recentOrders = await ctx.db.query<{
      order_number: string;
      user_email: string;
      total_paise: string;
      state: string;
      created_at: string;
    }>(
      `select o.order_number, u.email as user_email, o.total_paise::text,
              o.state, o.created_at::text
         from orders o
         join users u on u.id = o.buyer_id
        order by o.created_at desc limit 10`,
    );

    // Top selling products
    const topProducts = await ctx.db.query<{
      title: string;
      kind: string;
      sold: string;
      revenue: string;
    }>(
      `select l.title, l.kind,
              count(o.id)::text as sold,
              coalesce(sum(o.total_paise), 0)::text as revenue
         from listings l
         left join orders o on o.listing_id = l.id
                           and o.state not in ('cancelled','refunded')
        group by l.id, l.title, l.kind
        order by sold desc, revenue desc limit 10`,
    );

    // Seller performance
    // The rating is a scalar subquery rather than a join: joining reviews would
    // multiply the order rows and inflate every sales figure on this table.
    const sellerPerf = await ctx.db.query<{
      display_name: string;
      total_sales: string;
      orders_count: string;
      rating: string | null;
      review_count: string;
    }>(
      `select s.display_name,
              coalesce(sum(o.total_paise), 0)::text as total_sales,
              count(o.id)::text as orders_count,
              (select avg(r.rating)::text from reviews r
                where r.subject_seller_id = s.id) as rating,
              (select count(*)::text from reviews r
                where r.subject_seller_id = s.id) as review_count
         from sellers s
         left join orders o on o.seller_id = s.id
                           and o.state not in ('cancelled','refunded')
        group by s.id, s.display_name
        order by total_sales desc limit 10`,
    );

    // Alert data.
    //
    // Support tickets and stock levels are deliberately absent: there is no
    // ticketing table and listings are one-of-a-kind, so neither has a real
    // number behind it. An invented one on a console staff act on is worse
    // than an empty space.
    const alerts = await ctx.db.query<Record<string, string>>(
      `select
         (select count(*) from payouts where state = 'pending')::text as pending_payouts,
         (select coalesce(sum(amount_paise), 0)::text from payouts where state = 'pending') as payout_amount,
         (select coalesce(sum(amount_paise), 0)::text from payouts where state = 'paid')    as payout_paid,
         (select count(*) from disputes
            where state not in ('closed','resolved_buyer','resolved_seller'))::text as open_disputes,
         (select count(*) from sellers
            where kyc_state in ('pending','under_review'))::text as kyc_pending_count,
         (select count(*) from listings where state = 'minted')::text as active_listings`,
    );

    const cnt = (counts.rows[0] ?? {}) as Record<string, string>;
    const fin = (financial.rows[0] ?? {}) as Record<string, string>;
    const alrt = (alerts.rows[0] ?? {}) as Record<string, string>;
    const n = (k: string): number => Number(cnt[k] ?? 0);
    const rupees = (k: string): number => Number(fin[k] ?? 0) / 100;

    return json({
      // The flat counts this endpoint has always returned. Kept alongside the
      // richer shape below rather than folded into it: they are the documented
      // contract, and moving them would break every existing caller silently.
      users: n('users'),
      sellers: n('sellers'),
      kycPending: n('kyc_pending') + n('kyc_review'),
      listings: n('products'),
      listingsLive: n('listings_live'),
      listingsDraft: n('listings_draft'),
      orders: n('orders'),
      reviewOpen: n('review_open'),
      disputesOpen: n('disputes_open'),

      kpis: {
        totalGmvInr: rupees('gmv'),
        totalOrders: n('orders'),
        totalUsers: n('users'),
        totalSellers: n('sellers'),
        totalProducts: n('products'),
        totalRevenueInr: rupees('revenue'),
      },
      // Null where there is no earlier period to compare against: growth from
      // nothing is not a percentage.
      trend: (() => {
        const t = (trend.rows[0] ?? {}) as Record<string, string>;
        const change = (now: number, prev: number): number | null =>
          prev === 0 ? null : Math.round(((now - prev) / prev) * 1000) / 10;
        return {
          gmvPct: change(Number(t['gmv_now'] ?? 0), Number(t['gmv_prev'] ?? 0)),
          ordersPct: change(Number(t['orders_now'] ?? 0), Number(t['orders_prev'] ?? 0)),
        };
      })(),
      alerts: {
        pendingPayoutsInr: Number(alrt['payout_amount'] ?? 0) / 100,
        paidPayoutsInr: Number(alrt['payout_paid'] ?? 0) / 100,
        disputesOpen: n('disputes_open'),
        kycPending: n('kyc_pending') + n('kyc_review'),
        activeListings: n('listings_live'),
      },
      salesSeries: series.rows.map((r) => ({
        day: r.day,
        gmvInr: Number(r.gmv) / 100,
      })),
      categoryBreakdown: categories.rows.map((r) => ({
        category: r.kind,
        gmvInr: Number(r.gmv) / 100,
        orders: Number(r.count),
      })),
      recentOrders: recentOrders.rows.map((r) => ({
        orderNumber: r.order_number,
        user: r.user_email.split('@')[0],
        amountInr: Number(r.total_paise) / 100,
        status: r.state,
        date: r.created_at.slice(0, 10),
      })),
      topProducts: topProducts.rows.map((r) => ({
        title: r.title,
        category: r.kind,
        sold: Number(r.sold),
        revenueInr: Number(r.revenue) / 100,
      })),
      sellerPerformance: sellerPerf.rows.map((r) => ({
        seller: r.display_name,
        totalSalesInr: Number(r.total_sales) / 100,
        orders: Number(r.orders_count),
        // Null, not zero: an unrated seller is not a badly rated one.
        rating: r.rating === null ? null : Math.round(Number(r.rating) * 10) / 10,
        reviewCount: Number(r.review_count),
      })),
    });
  });

  /** GET /v1/admin/sellers — the KYC queue, oldest first. */
  router.add('GET', '/v1/admin/sellers', async (ctx) => {
    await requireAdmin(ctx);
    const state = ctx.url.searchParams.get('kycState');

    // Enough to decide on, and no more. The last four characters of a PAN and
    // of an Aadhaar let an admin confirm the card a seller reads out over the
    // phone; the numbers themselves are not stored and cannot be shown here.
    const rows = await ctx.db.query<{
      id: string;
      display_name: string;
      kind: string;
      kyc_state: string;
      is_minting_verified: boolean;
      gstin: string | null;
      email: string;
      email_verified: boolean;
      phone_e164: string | null;
      phone_verified: boolean;
      pan_last4: string | null;
      pan_name_match: string | null;
      aadhaar_last4: string | null;
      created_at: string;
      listing_count: string;
    }>(
      `select s.id, s.display_name, s.kind, s.kyc_state, s.is_minting_verified,
              s.gstin, u.email,
              (u.email_verified_at is not null) as email_verified,
              u.phone_e164,
              (u.phone_verified_at is not null) as phone_verified,
              p.number_last4 as pan_last4,
              p.name_match_score::text as pan_name_match,
              a.number_last4 as aadhaar_last4,
              s.created_at::text as created_at,
              (select count(*) from listings l where l.seller_id = s.id)::text as listing_count
         from sellers s
         join users u on u.id = s.user_id
         left join kyc_documents p on p.seller_id = s.id and p.kind = 'pan'
         left join kyc_documents a on a.seller_id = s.id and a.kind = 'aadhaar_offline_xml'
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
        emailVerified: r.email_verified,
        mobile: r.phone_e164 === null ? null : maskMobile(r.phone_e164),
        mobileVerified: r.phone_verified,
        panLast4: r.pan_last4,
        // 1 when the PAN's surname initial appears in the name given, 0 when
        // it does not. A mismatch is worth a second look, not a rejection.
        panNameAgrees: r.pan_name_match === null ? null : Number(r.pan_name_match) >= 1,
        aadhaarMasked: r.aadhaar_last4 === null ? null : `XXXX XXXX ${r.aadhaar_last4}`,
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

    // Approval is what lets a seller publish at all, and it carries no
    // ceiling: an approved seller lists as many items as they like.
    const verified = state === 'verified';
    await ctx.db.query(
      `update sellers
          set kyc_state = $2::kyc_state,
              kyc_verified_at = case when $3 then now() else null end,
              approved_by = case when $3 then $4::uuid else null end,
              is_minting_verified = $3
        where id = $1`,
      [id, state, verified, actorId],
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
