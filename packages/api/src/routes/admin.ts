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
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { one } from '../db.ts';
import { csvName, csvResponse, toCsv } from '../csv.ts';

const KYC_STATES = ['pending', 'under_review', 'verified', 'rejected', 'suspended'] as const;
const LISTING_STATES = ['pending_review', 'minted', 'withdrawn', 'rejected'] as const;
const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;

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

  /**
   * PATCH /v1/admin/sellers/:id — correct a seller's details.
   *
   * What can be changed is narrower than it looks, and deliberately so. A PAN
   * or an Aadhaar number cannot be edited here or anywhere else, because
   * neither is stored: registration turned each into a one-way fingerprint and
   * its last four characters. A seller who typed theirs wrong re-registers it.
   * That is a worse afternoon for one person than an editable field would be,
   * and a far better one for everybody if this database is ever stolen.
   */
  router.add('PATCH', '/v1/admin/sellers/:id', async (ctx) => {
    const actorId = await requireAdmin(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());

    const before = one(
      await ctx.db.query<{
        display_name: string;
        legal_name: string | null;
        gstin: string | null;
        listing_limit: number;
      }>(
        `select display_name, legal_name, gstin, listing_limit from sellers where id = $1`,
        [id],
      ),
    );
    if (before === null) throw notFound('No such seller.');

    const patch: Record<string, unknown> = {};

    if ('displayName' in fields) {
      const name = requiredString(fields, 'displayName', 120);
      if (name.trim().length < 2) {
        throw badRequest('A trading name needs at least a couple of characters.', {
          displayName: 'too_short',
        });
      }
      patch['display_name'] = name.trim();
    }

    if ('legalName' in fields) patch['legal_name'] = optionalString(fields, 'legalName', 200);

    if ('gstin' in fields) {
      const gstin = optionalString(fields, 'gstin', 15);
      if (gstin !== null && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin)) {
        throw badRequest('That GSTIN does not look right.', { gstin: 'invalid' });
      }
      patch['gstin'] = gstin;
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest('Nothing to change.', { body: 'empty' });
    }

    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`);
    const updated = await ctx.db.query<{
      id: string;
      display_name: string;
      legal_name: string | null;
      gstin: string | null;
    }>(
      `update sellers set ${sets.join(', ')}
        where id = $1
        returning id, display_name, legal_name, gstin`,
      [id, ...Object.values(patch)],
    );

    // The trading name appears on every order a buyer has placed with them, so
    // changing it is not a cosmetic edit and is recorded as such.
    await audit(ctx, actorId, 'seller.edit', 'seller', id, before, patch);

    const row = updated.rows[0]!;
    return json({
      seller: {
        id: row.id,
        displayName: row.display_name,
        legalName: row.legal_name,
        gstin: row.gstin,
      },
    });
  });

  /** GET /v1/admin/listings — moderation list, filterable by seller. */
  router.add('GET', '/v1/admin/listings', async (ctx) => {
    await requireAdmin(ctx);
    const state = ctx.url.searchParams.get('state');
    const sellerId = ctx.url.searchParams.get('sellerId');

    const rows = await ctx.db.query<{
      id: string;
      title: string;
      state: string;
      price_paise: string | null;
      grade: string | null;
      seller_id: string;
      seller_name: string;
      serial_digits: string | null;
      created_at: string;
    }>(
      `select l.id, l.title, l.state, l.price_paise::text as price_paise, l.grade,
              l.seller_id, s.display_name as seller_name, n.serial_digits,
              l.created_at::text as created_at
         from listings l
         join sellers s on s.id = l.seller_id
         left join notes n on n.listing_id = l.id
        where ($1::text is null or l.state = $1::listing_state)
          and ($2::uuid is null or l.seller_id = $2::uuid)
        order by l.created_at desc
        limit 500`,
      [state, sellerId],
    );

    return json({
      listings: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        state: r.state,
        priceInr: r.price_paise === null ? null : Number(r.price_paise) / 100,
        grade: r.grade,
        sellerId: r.seller_id,
        sellerName: r.seller_name,
        serialDigits: r.serial_digits,
        createdAt: r.created_at,
      })),
    });
  });

  /**
   * PATCH /v1/admin/listings/:id — correct a listing's details.
   *
   * Staff editing somebody else's item is exactly the activity that has to be
   * reconstructable afterwards, so the before and after of every field touched
   * goes into the audit trail, which a trigger refuses to let anyone edit.
   *
   * Only the fields sent are changed. Omitting one leaves it alone, which is
   * what stops a form that loaded stale data from blanking everything a seller
   * wrote while an admin was fixing the price.
   */
  router.add('PATCH', '/v1/admin/listings/:id', async (ctx) => {
    const actorId = await requireAdmin(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());

    const before = one(
      await ctx.db.query<{
        title: string;
        description: string | null;
        price_paise: string | null;
        grade: string | null;
        seller_id: string;
      }>(
        `select title, description, price_paise::text as price_paise, grade, seller_id
           from listings where id = $1`,
        [id],
      ),
    );
    if (before === null) throw notFound('No such listing.');

    const patch: Record<string, unknown> = {};

    if ('title' in fields) {
      const title = requiredString(fields, 'title', 200);
      if (title.trim().length < 2) {
        throw badRequest('A title needs at least a couple of characters.', { title: 'too_short' });
      }
      patch['title'] = title.trim();
    }

    if ('description' in fields) {
      patch['description'] = optionalString(fields, 'description', 4000);
    }

    if ('grade' in fields) {
      const grade = optionalString(fields, 'grade', 8);
      if (grade !== null && !(GRADES as readonly string[]).includes(grade)) {
        throw badRequest(`Grade must be one of ${GRADES.join(', ')}.`, { grade: 'unknown' });
      }
      patch['grade'] = grade;
    }

    if ('priceInr' in fields) {
      const raw = fields['priceInr'];
      if (raw === null) {
        patch['price_paise'] = null;
      } else {
        const inr = Number(raw);
        if (!Number.isFinite(inr) || inr <= 0 || !Number.isInteger(inr)) {
          throw badRequest('Price must be a whole number of rupees, above zero.', {
            priceInr: 'invalid',
          });
        }
        // A price is stored in paise and never in floating point. Anything
        // beyond this is a typo rather than a banknote.
        if (inr > 100_000_000) {
          throw badRequest('That price looks like a mistake. Check it and try again.', {
            priceInr: 'implausible',
          });
        }
        patch['price_paise'] = inr * 100;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw badRequest('Nothing to change.', { body: 'empty' });
    }

    const sets = Object.keys(patch).map((k, i) => `${k} = $${i + 2}`);
    const updated = await ctx.db.query<{
      id: string;
      title: string;
      description: string | null;
      price_paise: string | null;
      grade: string | null;
      state: string;
    }>(
      `update listings set ${sets.join(', ')}
        where id = $1
        returning id, title, description, price_paise::text as price_paise, grade, state`,
      [id, ...Object.values(patch)],
    );

    await audit(ctx, actorId, 'listing.edit', 'listing', id, before, patch);

    const row = updated.rows[0]!;
    return json({
      listing: {
        id: row.id,
        title: row.title,
        description: row.description,
        priceInr: row.price_paise === null ? null : Number(row.price_paise) / 100,
        grade: row.grade,
        state: row.state,
      },
    });
  });

  /**
   * DELETE /v1/admin/listings/:id/media/:mediaId — take a photograph down.
   *
   * The row goes; the file on disk stays. A photograph removed because it is
   * disputed is evidence, and deleting the only copy of it is how a dispute
   * becomes one person's word against another's.
   */
  router.add('DELETE', '/v1/admin/listings/:id/media/:mediaId', async (ctx) => {
    const actorId = await requireAdmin(ctx);
    const id = ctx.params['id'] ?? '';
    const mediaId = ctx.params['mediaId'] ?? '';

    const before = one(
      await ctx.db.query<{ id: string; storage_key: string }>(
        `select id, storage_key from media where id = $1 and listing_id = $2`,
        [mediaId, id],
      ),
    );
    if (before === null) throw notFound('No such photograph.');

    await ctx.db.query(`delete from media where id = $1`, [mediaId]);
    await audit(ctx, actorId, 'listing.media.remove', 'listing', id, before, null);

    return json({ removed: mediaId });
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

  /**
   * GET /v1/admin/users — the account list.
   *
   * No password hash, no consent record and no last-seen timestamp: staff
   * looking up an account to help somebody need none of the three, and each is
   * a thing that leaks if this list is ever left open.
   */
  router.add('GET', '/v1/admin/users', async (ctx) => {
    await requireAdmin(ctx);
    const q = ctx.url.searchParams.get('q');

    const rows = await ctx.db.query<{
      id: string;
      email: string;
      full_name: string | null;
      status: string;
      email_verified: boolean;
      phone_e164: string | null;
      created_at: string;
      roles: string | null;
      orders: string;
      is_seller: boolean;
    }>(
      `select u.id, u.email, u.full_name, u.status,
              (u.email_verified_at is not null) as email_verified,
              u.phone_e164, u.created_at::text as created_at,
              (select string_agg(r.role::text, ',') from user_roles r where r.user_id = u.id) as roles,
              (select count(*) from orders o where o.buyer_id = u.id)::text as orders,
              exists (select 1 from sellers s where s.user_id = u.id) as is_seller
         from users u
        where ($1::text is null
               or u.email ilike '%' || $1 || '%'
               or coalesce(u.full_name, '') ilike '%' || $1 || '%')
        order by u.created_at desc
        limit 200`,
      [q],
    );

    return json({
      users: rows.rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        status: r.status,
        emailVerified: r.email_verified,
        mobile: r.phone_e164 === null ? null : maskMobile(r.phone_e164),
        roles: r.roles === null ? [] : r.roles.split(','),
        orders: Number(r.orders),
        isSeller: r.is_seller,
        createdAt: r.created_at,
      })),
    });
  });

  /** GET /v1/admin/orders — every order, newest first. */
  router.add('GET', '/v1/admin/orders', async (ctx) => {
    await requireAdmin(ctx);
    const state = ctx.url.searchParams.get('state');

    const rows = await ctx.db.query<{
      id: string;
      order_number: string;
      state: string;
      total_paise: string;
      created_at: string;
      buyer_email: string;
      seller_name: string;
      title: string | null;
    }>(
      `select o.id, o.order_number, o.state, o.total_paise::text as total_paise,
              o.created_at::text as created_at,
              u.email as buyer_email, s.display_name as seller_name, l.title
         from orders o
         join users u   on u.id = o.buyer_id
         join sellers s on s.id = o.seller_id
         left join listings l on l.id = o.listing_id
        where ($1::text is null or o.state = $1::order_state)
        order by o.created_at desc
        limit 200`,
      [state],
    );

    return json({
      orders: rows.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        state: r.state,
        totalInr: Number(r.total_paise) / 100,
        buyer: r.buyer_email,
        seller: r.seller_name,
        title: r.title,
        createdAt: r.created_at,
      })),
    });
  });

  /**
   * GET /v1/admin/transactions — money in, as the gateway reported it.
   *
   * The gateway's own payment id travels with each row: it is the reference
   * both sides quote when a payment has to be traced, and without it a
   * reconciliation is guesswork.
   */
  router.add('GET', '/v1/admin/transactions', async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query<{
      id: string;
      order_number: string;
      gateway: string;
      gateway_payment_id: string | null;
      method: string | null;
      amount_paise: string;
      state: string;
      failure_reason: string | null;
      created_at: string;
    }>(
      `select p.id, o.order_number, p.gateway, p.gateway_payment_id, p.method,
              p.amount_paise::text as amount_paise, p.state, p.failure_reason,
              p.created_at::text as created_at
         from payments p
         join orders o on o.id = p.order_id
        order by p.created_at desc
        limit 200`,
    );

    return json({
      transactions: rows.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        gateway: r.gateway,
        gatewayPaymentId: r.gateway_payment_id,
        method: r.method,
        amountInr: Number(r.amount_paise) / 100,
        state: r.state,
        failureReason: r.failure_reason,
        createdAt: r.created_at,
      })),
    });
  });

  /** GET /v1/admin/reviews — what buyers said, across every seller. */
  router.add('GET', '/v1/admin/reviews', async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query<{
      id: string;
      rating: number;
      body: string | null;
      created_at: string;
      order_number: string;
      seller_name: string;
      reviewer: string;
    }>(
      `select r.id, r.rating, r.body, r.created_at::text as created_at,
              o.order_number, s.display_name as seller_name,
              coalesce(u.full_name, split_part(u.email, '@', 1)) as reviewer
         from reviews r
         join orders o  on o.id = r.order_id
         join sellers s on s.id = r.subject_seller_id
         join users u   on u.id = r.reviewer_id
        order by r.created_at desc
        limit 200`,
    );

    return json({
      reviews: rows.rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        orderNumber: r.order_number,
        seller: r.seller_name,
        reviewer: r.reviewer,
        createdAt: r.created_at,
      })),
    });
  });

  /** GET /v1/admin/categories — the catalogue tree, with how much sits in each. */
  router.add('GET', '/v1/admin/categories', async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      parent_name: string | null;
      sort_order: number;
      description: string | null;
    }>(
      `select c.id, c.slug, c.name, c.kind, p.name as parent_name,
              c.sort_order, c.description
         from categories c
         left join categories p on p.id = c.parent_id
        order by c.sort_order asc, c.name asc
        limit 500`,
    );

    // Listings carry a kind rather than a category id, so the count is by kind
    // and is reported as such rather than dressed up as a per-category total.
    const byKind = await ctx.db.query<{ kind: string; n: string }>(
      `select kind, count(*)::text as n from listings group by kind`,
    );
    const counts = new Map(byKind.rows.map((r) => [r.kind, Number(r.n)]));

    return json({
      categories: rows.rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        kind: r.kind,
        parent: r.parent_name,
        sortOrder: r.sort_order,
        description: r.description,
        listingsOfKind: counts.get(r.kind) ?? 0,
      })),
    });
  });

  /**
   * GET /v1/admin/reports/:report.csv — a report, downloadable.
   *
   * Money is reported in rupees with the paise as a separate column rather
   * than as a decimal: a spreadsheet reading 1250.30 as a float and summing a
   * thousand of them does not reliably give back the number it started with,
   * and this is the file somebody reconciles a bank statement against.
   */
  router.add('GET', '/v1/admin/reports/:report', async (ctx) => {
    await requireAdmin(ctx);
    const report = (ctx.params['report'] ?? '').replace(/\.csv$/, '');

    if (report === 'listings') {
      const rows = await ctx.db.query<Record<string, string | null>>(
        `select l.id::text, l.title, l.kind::text, l.state::text,
                coalesce(n.serial_digits, '') as serial,
                coalesce(l.grade, '') as grade,
                (l.price_paise / 100)::text as price_inr,
                (l.price_paise % 100)::text as price_paise,
                s.display_name as seller,
                l.view_count::text as views,
                (select count(*) from media m where m.listing_id = l.id)::text as photos,
                l.created_at::date::text as listed_on
           from listings l
           join sellers s on s.id = l.seller_id
           left join notes n on n.listing_id = l.id
          order by l.created_at desc`,
      );
      return csvResponse(
        csvName('listings'),
        toCsv(
          ['Listing ID', 'Title', 'Kind', 'State', 'Serial', 'Grade', 'Price (₹)', 'Paise', 'Seller', 'Views', 'Photos', 'Listed on'],
          rows.rows.map((r) => Object.values(r)),
        ),
      );
    }

    if (report === 'sellers') {
      const rows = await ctx.db.query<Record<string, string | null>>(
        `select s.id::text, s.display_name, s.kind::text, s.kyc_state::text,
                u.email,
                case when u.email_verified_at is null then 'no' else 'yes' end as email_verified,
                coalesce(p.number_last4, '') as pan_last4,
                (select count(*) from listings l where l.seller_id = s.id)::text as listings,
                (select count(*) from orders o where o.seller_id = s.id
                   and o.state not in ('cancelled','refunded'))::text as orders,
                (select coalesce(sum(o.total_paise), 0) / 100 from orders o
                  where o.seller_id = s.id and o.state not in ('cancelled','refunded'))::text as sales_inr,
                s.created_at::date::text as joined
           from sellers s
           join users u on u.id = s.user_id
           left join kyc_documents p on p.seller_id = s.id and p.kind = 'pan'
          order by s.created_at desc`,
      );
      return csvResponse(
        csvName('sellers'),
        toCsv(
          ['Seller ID', 'Trading as', 'Type', 'KYC', 'Email', 'Email verified', 'PAN last 4', 'Listings', 'Orders', 'Sales (₹)', 'Joined'],
          rows.rows.map((r) => Object.values(r)),
        ),
      );
    }

    if (report === 'sales') {
      const rows = await ctx.db.query<Record<string, string | null>>(
        `select o.order_number, o.state::text, o.created_at::date::text as placed_on,
                u.email as buyer, s.display_name as seller,
                coalesce(l.title, '') as item,
                (o.subtotal_paise / 100)::text   as subtotal_inr,
                (o.commission_paise / 100)::text as commission_inr,
                (o.gst_on_commission_paise / 100)::text as gst_inr,
                (o.tds_paise / 100)::text        as tds_inr,
                (o.total_paise / 100)::text      as total_inr,
                (o.total_paise % 100)::text      as total_paise
           from orders o
           join users u   on u.id = o.buyer_id
           join sellers s on s.id = o.seller_id
           left join listings l on l.id = o.listing_id
          order by o.created_at desc`,
      );
      return csvResponse(
        csvName('sales'),
        toCsv(
          ['Order', 'State', 'Placed on', 'Buyer', 'Seller', 'Item', 'Subtotal (₹)', 'Commission (₹)', 'GST (₹)', 'TDS (₹)', 'Total (₹)', 'Paise'],
          rows.rows.map((r) => Object.values(r)),
        ),
      );
    }

    if (report === 'payouts') {
      const rows = await ctx.db.query<Record<string, string | null>>(
        `select p.id::text, p.state::text, o.order_number,
                s.display_name as seller, u.email as seller_email,
                coalesce(b.account_masked, '') as bank_account,
                coalesce(b.ifsc, '') as ifsc,
                (p.amount_paise / 100)::text as amount_inr,
                (p.amount_paise % 100)::text as amount_paise,
                coalesce(p.gateway_payout_id, '') as transfer_reference,
                coalesce(p.hold_reason, '') as hold_reason,
                p.created_at::date::text as created_on,
                coalesce(p.released_at::date::text, '') as released_on
           from payouts p
           join orders o  on o.id = p.order_id
           join sellers s on s.id = p.seller_id
           join users u   on u.id = s.user_id
           left join bank_accounts b on b.id = p.bank_account_id
          order by p.created_at desc`,
      );
      return csvResponse(
        csvName('payouts'),
        toCsv(
          ['Payout ID', 'State', 'Order', 'Seller', 'Seller email', 'Bank account', 'IFSC', 'Amount (₹)', 'Paise', 'Transfer reference', 'Hold reason', 'Created', 'Released'],
          rows.rows.map((r) => Object.values(r)),
        ),
      );
    }

    if (report === 'buyers') {
      const rows = await ctx.db.query<Record<string, string | null>>(
        `select u.id::text, coalesce(u.full_name, '') as name, u.email,
                case when u.email_verified_at is null then 'no' else 'yes' end as email_verified,
                (select count(*) from orders o where o.buyer_id = u.id)::text as orders,
                (select coalesce(sum(o.total_paise), 0) / 100 from orders o
                  where o.buyer_id = u.id and o.state not in ('cancelled','refunded'))::text as spent_inr,
                u.created_at::date::text as joined
           from users u
          order by u.created_at desc`,
      );
      return csvResponse(
        csvName('buyers'),
        toCsv(
          ['User ID', 'Name', 'Email', 'Email verified', 'Orders', 'Spent (₹)', 'Joined'],
          rows.rows.map((r) => Object.values(r)),
        ),
      );
    }

    throw notFound('No such report.');
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
