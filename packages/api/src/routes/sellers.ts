/**
 * Seller onboarding.
 *
 * Becoming a seller is a profile plus a role, not a new account. KYC is a
 * separate, later step: a seller can draft listings while `kyc_state` is
 * pending, but publishing and payouts stay gated on verification, which is what
 * keeps an unverified account from taking money.
 */

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { conflict, forbidden, unauthorized } from '../errors.ts';
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { one } from '../db.ts';

const SELLER_KINDS = ['individual', 'sole_proprietor', 'company', 'registered_dealer'] as const;

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
    listingLimit: row.listing_limit,
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

export function registerSellerRoutes(router: Router): void {
  /** POST /v1/sellers — become a seller. */
  router.add('POST', '/v1/sellers', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const fields = asObject(await ctx.body());
    const kind = oneOf(fields, 'kind', SELLER_KINDS);
    const displayName = requiredString(fields, 'displayName', 120);
    const legalName = optionalString(fields, 'legalName', 200);
    const gstin = optionalString(fields, 'gstin', 15);

    const existing = await currentSeller(ctx);
    if (existing !== null) {
      throw conflict('This account is already registered as a seller.');
    }

    const created = await ctx.db.query<SellerRow>(
      `insert into sellers (user_id, kind, display_name, legal_name, gstin)
       values ($1, $2, $3, $4, $5)
       returning id, user_id, kind, display_name, legal_name, gstin, kyc_state,
                 is_minting_verified, listing_limit, created_at`,
      [ctx.session.userId, kind, displayName, legalName, gstin],
    );

    const seller = created.rows[0];
    if (seller === undefined) throw new Error('failed to create seller');

    await ctx.db.query(
      `insert into user_roles (user_id, role) values ($1, 'seller')
       on conflict (user_id, role) do nothing`,
      [ctx.session.userId],
    );

    await ctx.db.query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
       values ($1::uuid, 'seller.register', 'seller', $2::text, $3::inet, $4)`,
      [ctx.session.userId, seller.id, ctx.ip, ctx.userAgent],
    );

    return json({ seller: publicSeller(seller) }, 201);
  });

  /** GET /v1/sellers/me */
  router.add('GET', '/v1/sellers/me', async (ctx) => {
    const seller = await requireSeller(ctx);
    return json({ seller: publicSeller(seller) });
  });
}
