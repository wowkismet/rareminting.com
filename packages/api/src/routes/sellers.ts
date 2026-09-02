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
}
