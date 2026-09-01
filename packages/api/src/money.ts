/**
 * Order arithmetic.
 *
 * Every amount is an integer number of paise. Nothing here uses a float: a
 * marketplace that computes commission in floating point will, eventually,
 * settle a payout one paisa out and spend a day reconciling it.
 *
 * Rates arrive as basis points (1 bps = 0.01%), which keeps them integers too.
 * They come from `commission_rules` rather than from code, so an operator can
 * change a take rate from the admin console without a deploy.
 *
 * Two sides of the same order:
 *
 *   what the buyer pays  = subtotal + shipping + buyer's premium
 *   what the seller gets = subtotal − commission − GST on commission − TDS
 *
 * The platform keeps the commission; the GST and TDS are collected on behalf of
 * the tax authority, not earned.
 */

export interface Rates {
  /** Platform take, in basis points of the item price. */
  readonly takeRateBps: number;
  /** Flat fee per listing sold, in paise. */
  readonly listingFeePaise: number;
  /** Auction buyer's premium, in basis points. Zero for fixed-price sales. */
  readonly buyerPremiumBps: number;
  /** GST charged on the platform's commission. */
  readonly gstRateBps: number;
  /** Withholding on the seller's gross, under section 194-O. */
  readonly tdsRateBps: number;
}

export interface Breakdown {
  readonly subtotalPaise: number;
  readonly shippingPaise: number;
  readonly buyerPremiumPaise: number;
  /** What the buyer is charged. */
  readonly totalPaise: number;

  readonly commissionPaise: number;
  readonly gstOnCommissionPaise: number;
  readonly tdsPaise: number;
  /** What reaches the seller after everything is withheld. */
  readonly sellerPayoutPaise: number;
}

/**
 * Apply a basis-point rate to an amount.
 *
 * Rounds half away from zero, matching how an invoice would be read by a
 * person. Every call goes through here so that rounding is applied once, in one
 * place, rather than drifting between call sites.
 */
export function applyBps(amountPaise: number, bps: number): number {
  if (!Number.isInteger(amountPaise)) {
    throw new TypeError(`amount must be whole paise, received ${amountPaise}`);
  }
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`rate must be a non-negative whole number of basis points, received ${bps}`);
  }
  return Math.round((amountPaise * bps) / 10_000);
}

export interface BreakdownInput {
  readonly subtotalPaise: number;
  readonly shippingPaise?: number;
  readonly rates: Rates;
}

export function computeBreakdown({
  subtotalPaise,
  shippingPaise = 0,
  rates,
}: BreakdownInput): Breakdown {
  if (!Number.isInteger(subtotalPaise) || subtotalPaise <= 0) {
    throw new RangeError('subtotal must be a positive whole number of paise');
  }
  if (!Number.isInteger(shippingPaise) || shippingPaise < 0) {
    throw new RangeError('shipping must be a non-negative whole number of paise');
  }

  const buyerPremiumPaise = applyBps(subtotalPaise, rates.buyerPremiumBps);
  const totalPaise = subtotalPaise + shippingPaise + buyerPremiumPaise;

  const commissionPaise = applyBps(subtotalPaise, rates.takeRateBps) + rates.listingFeePaise;
  const gstOnCommissionPaise = applyBps(commissionPaise, rates.gstRateBps);

  // 194-O withholding is on the seller's gross consideration, before the
  // platform's own deductions — not on what is left after them.
  const tdsPaise = applyBps(subtotalPaise, rates.tdsRateBps);

  const sellerPayoutPaise =
    subtotalPaise - commissionPaise - gstOnCommissionPaise - tdsPaise;

  if (sellerPayoutPaise < 0) {
    throw new RangeError(
      'Deductions exceed the sale price. Check the take rate and listing fee — ' +
        'a seller must never owe money on a sale.',
    );
  }

  return {
    subtotalPaise,
    shippingPaise,
    buyerPremiumPaise,
    totalPaise,
    commissionPaise,
    gstOnCommissionPaise,
    tdsPaise,
    sellerPayoutPaise,
  };
}

/** Rupees for display. Never used for arithmetic. */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Fallback rates, used when no rule matches.
 *
 * Deliberately conservative and clearly marked: a missing rule should not mean
 * a free sale. Confirm the GST and TDS figures with a chartered accountant
 * rather than treating these as authoritative.
 */
export const DEFAULT_RATES: Rates = {
  takeRateBps: 1000, // 10%
  listingFeePaise: 0,
  buyerPremiumBps: 0,
  gstRateBps: 1800, // 18% on commission
  tdsRateBps: 100, // 1% under 194-O
};
