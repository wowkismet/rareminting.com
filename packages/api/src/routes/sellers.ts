/**
 * Seller onboarding.
 *
 * Registration asks for six things and no more: name, mobile, email, PAN,
 * Aadhaar and the OTP proving the mobile is theirs. The email is already on
 * the account, so the form itself collects five.
 *
 * Identity numbers are checked here and then discarded. What reaches the
 * database is an HMAC and the last four characters — see kyc.ts. Nothing in
 * this file returns a PAN or an Aadhaar number to any caller, including the
 * seller who supplied it and including an admin.
 *
 * Registering does not let anyone sell. It puts the seller in the admin queue;
 * publishing stays closed until an admin approves them, and once approved they
 * may list without limit.
 */

import {
  maskMobile,
  panAgreesWithName,
  parseAadhaar,
  parseIndianMobile,
  parsePan,
} from '@rareminting/config';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from '../errors.ts';
import { asObject, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';
import { hashIdentityNumber, kycStorageConfigured } from '../kyc.ts';
import { issueMobileOtp, otpAvailable, recentlyVerified, verifyMobileOtp } from '../otp.ts';

export interface SellerRow {
  id: string;
  user_id: string;
  kind: string;
  display_name: string;
  legal_name: string | null;
  gstin: string | null;
  kyc_state: string;
  is_minting_verified: boolean;
  listing_limit: number;
  created_at: Date | string;
}

/** A seller may publish only once an admin has approved them. */
export function isApproved(row: SellerRow): boolean {
  return row.kyc_state === 'verified';
}

export function publicSeller(row: SellerRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    legalName: row.legal_name,
    gstin: row.gstin,
    kycState: row.kyc_state,
    // The public "Minting Verified" badge.
    mintingVerified: row.is_minting_verified,
    // Approved sellers list without limit, so there is no number to report.
    approved: isApproved(row),
    createdAt: row.created_at,
  };
}

/** The seller profile for the signed-in user, or null. */
export async function currentSeller(ctx: Ctx): Promise<SellerRow | null> {
  if (ctx.session === null) return null;
  const result = await ctx.db.query<SellerRow>(
    `select id, user_id, kind, display_name, legal_name, gstin, kyc_state,
            is_minting_verified, listing_limit, created_at
       from sellers where user_id = $1`,
    [ctx.session.userId],
  );
  return one(result);
}

/** Seller profile or a 403 — the guard every seller-only route uses. */
export async function requireSeller(ctx: Ctx): Promise<SellerRow> {
  if (ctx.session === null) throw unauthorized();
  const seller = await currentSeller(ctx);
  if (seller === null) {
    throw forbidden('Register as a seller before listing items.');
  }
  return seller;
}

/**
 * Seller profile, approved, or a 403.
 *
 * The gate on publishing and on taking money. Drafting is deliberately left
 * open so a seller can prepare listings while they wait for review.
 */
export async function requireApprovedSeller(ctx: Ctx): Promise<SellerRow> {
  const seller = await requireSeller(ctx);
  if (!isApproved(seller)) {
    throw forbidden(
      seller.kyc_state === 'rejected'
        ? 'Your seller account was not approved. Contact support to find out why.'
        : 'An admin is still reviewing your account. You can prepare listings now and publish them once you are approved.',
    );
  }
  return seller;
}

export function registerSellerRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/otp/mobile — send a code to a mobile number.
   *
   * Signed in, because this is a step inside seller registration rather than a
   * way to send messages to arbitrary numbers.
   */
  router.add('POST', '/v1/otp/mobile', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const fields = asObject(await ctx.body());
    const mobile = parseIndianMobile(requiredString(fields, 'mobile', 20));
    if (mobile === null) {
      throw badRequest('Enter a ten-digit Indian mobile number.', { mobile: 'invalid' });
    }

    const result = await issueMobileOtp(ctx.db, mobile, 'seller_mobile');
    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        throw tooManyRequests('Too many codes requested. Try again in an hour.');
      }
      // No provider configured. Say so plainly rather than pretend to send.
      return json(
        {
          sent: false,
          reason: 'unavailable',
          message: 'Mobile verification is not switched on yet. You can register without it.',
        },
        503,
      );
    }

    return json({ sent: true, to: maskMobile(mobile) });
  });

  /** POST /v1/otp/mobile/verify — exchange a code for a verified mobile. */
  router.add('POST', '/v1/otp/mobile/verify', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const fields = asObject(await ctx.body());
    const mobile = parseIndianMobile(requiredString(fields, 'mobile', 20));
    if (mobile === null) {
      throw badRequest('Enter a ten-digit Indian mobile number.', { mobile: 'invalid' });
    }
    const code = requiredString(fields, 'code', 6);

    const result = await verifyMobileOtp(ctx.db, mobile, 'seller_mobile', code);
    if (!result.ok) {
      if (result.reason === 'exhausted') {
        throw tooManyRequests('Too many wrong codes. Request a new one.');
      }
      // Every other failure reads the same, so this cannot be used to learn
      // which numbers have a code outstanding.
      throw badRequest('That code is wrong or has expired. Request a new one.', {
        code: 'invalid',
      });
    }

    return json({ verified: true });
  });

  /** POST /v1/sellers — become a seller. */
  router.add('POST', '/v1/sellers', async (ctx) => {
    const session = ctx.session;
    if (session === null) throw unauthorized();

    if (!kycStorageConfigured()) {
      // Refusing is the only safe answer: without the pepper the numbers would
      // be stored as brute-forceable digests.
      throw forbidden('Seller registration is temporarily unavailable. Please try again later.');
    }

    const fields = asObject(await ctx.body());

    const fullName = requiredString(fields, 'fullName', 120);
    if (fullName.length < 2) {
      throw badRequest('Enter your full name as printed on your PAN card.', {
        fullName: 'too_short',
      });
    }

    const mobile = parseIndianMobile(requiredString(fields, 'mobile', 20));
    if (mobile === null) {
      throw badRequest('Enter a ten-digit Indian mobile number.', { mobile: 'invalid' });
    }

    const pan = parsePan(requiredString(fields, 'pan', 12));
    if (pan === null) {
      throw badRequest('That PAN does not look right. It reads like ABCDE1234F.', {
        pan: 'invalid',
      });
    }
    if (pan.holderCode !== 'P') {
      throw badRequest(
        `That PAN belongs to a ${pan.holderType.toLowerCase()}. Register with the PAN of the person selling.`,
        { pan: 'not_individual' },
      );
    }

    const aadhaar = parseAadhaar(requiredString(fields, 'aadhaar', 20));
    if (aadhaar === null) {
      throw badRequest('That Aadhaar number is not valid. Check the twelve digits.', {
        aadhaar: 'invalid',
      });
    }

    const existing = await currentSeller(ctx);
    if (existing !== null) {
      throw conflict('This account is already registered as a seller.');
    }

    // Mobile verification, where it is switched on. Where it is not, the
    // number is recorded unverified and the admin queue shows it as such —
    // approval, not OTP, is what actually gates selling.
    let mobileVerified = false;
    if (otpAvailable()) {
      const code = typeof fields['otp'] === 'string' ? fields['otp'] : '';
      mobileVerified =
        code === ''
          ? await recentlyVerified(ctx.db, mobile, 'seller_mobile')
          : (await verifyMobileOtp(ctx.db, mobile, 'seller_mobile', code)).ok;
      if (!mobileVerified) {
        throw badRequest('Verify your mobile number before registering.', { otp: 'required' });
      }
    }

    const panHash = hashIdentityNumber(pan.normalized);
    const aadhaarHash = hashIdentityNumber(aadhaar.normalized);

    // One PAN, one seller. Checked before writing so the caller gets a clear
    // message rather than a unique-violation.
    const clash = await ctx.db.query<{ kind: string }>(
      `select kind from kyc_documents
        where (kind = 'pan' and number_hash = $1)
           or (kind = 'aadhaar_offline_xml' and number_hash = $2)
        limit 1`,
      [panHash, aadhaarHash],
    );
    if (clash.rows.length > 0) {
      throw conflict('Those identity details are already registered to another seller account.');
    }

    // A weak agreement check between the PAN and the name given. Recorded for
    // the reviewing admin rather than enforced, because the fifth character of
    // a PAN is the surname initial and a free-text name does not reliably say
    // which part is the surname.
    const nameMatch = panAgreesWithName(pan, fullName) ? 1 : 0;

    const seller = await database.transaction(async (tx) => {
      const created = await tx.query<SellerRow>(
        `insert into sellers (user_id, kind, display_name, legal_name)
         values ($1, 'individual', $2, $2)
         returning id, user_id, kind, display_name, legal_name, gstin, kyc_state,
                   is_minting_verified, listing_limit, created_at`,
        [session.userId, fullName],
      );
      const row = created.rows[0];
      if (row === undefined) throw new Error('failed to create seller');

      await tx.query(
        `update users
            set full_name = $2,
                phone_e164 = $3,
                phone_verified_at = case when $4 then now() else phone_verified_at end
          where id = $1`,
        [session.userId, fullName, mobile, mobileVerified],
      );

      await tx.query(
        `insert into kyc_documents (seller_id, kind, number_hash, number_last4, name_match_score)
         values ($1, 'pan', $2, $3, $4)`,
        [row.id, panHash, pan.last4, nameMatch],
      );
      await tx.query(
        `insert into kyc_documents (seller_id, kind, number_hash, number_last4)
         values ($1, 'aadhaar_offline_xml', $2, $3)`,
        [row.id, aadhaarHash, aadhaar.last4],
      );

      await tx.query(
        `insert into user_roles (user_id, role) values ($1, 'seller')
         on conflict (user_id, role) do nothing`,
        [session.userId],
      );

      // The audit trail records that registration happened, never the numbers.
      await tx.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
         values ($1::uuid, 'seller.register', 'seller', $2::text, $3::inet, $4)`,
        [session.userId, row.id, ctx.ip, ctx.userAgent],
      );

      return row;
    });

    return json(
      {
        seller: publicSeller(seller),
        mobile: { number: maskMobile(mobile), verified: mobileVerified },
        pan: { last4: pan.last4 },
        aadhaar: { masked: aadhaar.masked },
        next: 'An admin will review your details. You can prepare listings now and publish them once you are approved.',
      },
      201,
    );
  });

  /** GET /v1/sellers/me */
  router.add('GET', '/v1/sellers/me', async (ctx) => {
    const seller = await requireSeller(ctx);
    return json({ seller: publicSeller(seller) });
  });

  /**
   * GET /v1/sellers/me/dashboard — everything the seller's own page shows.
   *
   * One round trip rather than six, because the dashboard is the page a seller
   * lands on and it should not need a waterfall of requests to draw itself.
   *
   * Money is reported two ways on purpose. Gross is what buyers paid; payout is
   * what actually reaches the seller once commission, GST on that commission
   * and TDS come out. Showing only the gross would overstate their earnings.
   */
  router.add('GET', '/v1/sellers/me/dashboard', async (ctx) => {
    const seller = await requireSeller(ctx);

    const counts = await ctx.db.query<Record<string, string>>(
      `select
         count(*)::text                                                as total,
         count(*) filter (where state = 'draft')::text                 as draft,
         count(*) filter (where state = 'pending_review')::text        as in_review,
         count(*) filter (where state = 'minted')::text                as live,
         count(*) filter (where state = 'reserved')::text              as reserved,
         count(*) filter (where state = 'struck')::text                as sold,
         count(*) filter (where state = 'withdrawn')::text             as withdrawn,
         count(*) filter (where kind = 'banknote')::text               as notes,
         count(*) filter (where kind = 'coin')::text                   as coins,
         count(*) filter (where kind not in ('banknote','coin'))::text as other,
         coalesce(sum(view_count), 0)::text                            as views
       from listings where seller_id = $1`,
      [seller.id],
    );

    // Orders and money are counted differently on purpose. An order exists the
    // moment a buyer commits; the money is only real once payment clears. With
    // no payment gateway live yet every order sits at payment_pending, so
    // folding the two together would either show a permanent zero or claim
    // earnings that have not arrived.
    const PAID = `state in ('paid','packed','shipped','delivered','inspection','completed','disputed')`;
    const sales = await ctx.db.query<Record<string, string>>(
      `select
         count(*)::text                                          as orders,
         count(*) filter (where state in ('created','payment_pending'))::text
                                                                 as awaiting_payment,
         count(*) filter (where state in ('paid','packed'))::text as awaiting_dispatch,
         count(*) filter (where state = 'completed')::text        as completed,
         coalesce(sum(subtotal_paise) filter (where ${PAID}), 0)::text as gross_paise,
         coalesce(sum(subtotal_paise - commission_paise
                      - gst_on_commission_paise - tds_paise)
                  filter (where ${PAID}), 0)::text                as payout_paise,
         coalesce(sum(subtotal_paise), 0)::text                   as committed_paise
       from orders
      where seller_id = $1 and state not in ('cancelled','refunded')`,
      [seller.id],
    );

    const auctions = await ctx.db.query<Record<string, string>>(
      `select
         count(*) filter (where a.state = 'live')::text      as live,
         count(*) filter (where a.state = 'scheduled')::text as scheduled,
         count(*) filter (where a.state = 'ended')::text     as ended,
         coalesce(sum(a.bid_count), 0)::text                 as bids
       from auctions a
       join listings l on l.id = a.listing_id
      where l.seller_id = $1`,
      [seller.id],
    );

    // The listings themselves, newest first, with the two things a seller
    // acts on: whether it has a photograph, and how many people have looked.
    const rows = await ctx.db.query<{
      id: string;
      title: string;
      state: string;
      kind: string;
      price_paise: string | null;
      grade: string | null;
      view_count: number;
      photo_count: string;
      thumb: string | null;
      serial_digits: string | null;
      denomination: number | null;
      created_at: string;
    }>(
      `select l.id, l.title, l.state, l.kind, l.price_paise::text as price_paise, l.grade,
              l.view_count,
              (select count(*) from media m where m.listing_id = l.id)::text as photo_count,
              (select m.storage_key from media m
                where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb,
              n.serial_digits, n.denomination,
              l.created_at::text as created_at
         from listings l
         left join notes n on n.listing_id = l.id
        where l.seller_id = $1
        order by l.created_at desc
        limit 200`,
      [seller.id],
    );

    const c = counts.rows[0] ?? {};
    const s = sales.rows[0] ?? {};
    const a = auctions.rows[0] ?? {};
    const n = (source: Record<string, string>, key: string): number => Number(source[key] ?? 0);
    const rupees = (source: Record<string, string>, key: string): number =>
      Number(source[key] ?? 0) / 100;

    return json({
      seller: publicSeller(seller),
      stats: {
        listings: {
          total: n(c, 'total'),
          draft: n(c, 'draft'),
          inReview: n(c, 'in_review'),
          live: n(c, 'live'),
          reserved: n(c, 'reserved'),
          sold: n(c, 'sold'),
          withdrawn: n(c, 'withdrawn'),
        },
        byKind: { notes: n(c, 'notes'), coins: n(c, 'coins'), other: n(c, 'other') },
        views: n(c, 'views'),
        sales: {
          orders: n(s, 'orders'),
          completed: n(s, 'completed'),
          awaitingPayment: n(s, 'awaiting_payment'),
          awaitingDispatch: n(s, 'awaiting_dispatch'),
          /** What buyers paid, on orders where payment actually cleared. */
          grossInr: rupees(s, 'gross_paise'),
          /** What reaches the seller, after commission, GST and TDS. */
          payoutInr: rupees(s, 'payout_paise'),
          /** Including orders still awaiting payment. Not yet earned. */
          committedInr: rupees(s, 'committed_paise'),
        },
        auctions: {
          live: n(a, 'live'),
          scheduled: n(a, 'scheduled'),
          ended: n(a, 'ended'),
          bids: n(a, 'bids'),
        },
      },
      listings: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        state: r.state,
        kind: r.kind,
        priceInr: r.price_paise === null ? null : Number(r.price_paise) / 100,
        grade: r.grade,
        views: r.view_count,
        photoCount: Number(r.photo_count),
        imageUrl: r.thumb === null ? null : `/media/${r.thumb}`,
        serialDigits: r.serial_digits,
        denomination: r.denomination,
        createdAt: r.created_at,
      })),
    });
  });
}
