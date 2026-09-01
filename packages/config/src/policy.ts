/**
 * Commercial policy terms.
 *
 * These are numbers the published policy states *and* the code enforces. Keeping
 * them here means the refund page and the payout scheduler cannot disagree: if
 * the inspection window changes, the sentence a customer reads and the moment a
 * seller is actually paid change together.
 *
 * Every value carries a `DECISION` note where it reflects a commercial choice
 * rather than a legal requirement. Those are the ones to confirm before launch.
 */

export interface RefundPolicy {
  /**
   * Days a buyer has to inspect a delivered item and raise a claim.
   * Seller payout is held until this closes.
   * From §7 of the build specification.
   */
  readonly inspectionWindowDays: number;
  /** Working days to return money after a refund is approved. */
  readonly refundProcessingDays: { readonly min: number; readonly max: number };
  /**
   * DECISION: change-of-mind returns are not accepted.
   * Usual for graded collectibles, where handling affects condition and
   * provenance. Turning this on means accepting returns on items that may come
   * back in a different state than they left.
   */
  readonly acceptsChangeOfMind: boolean;
  /**
   * DECISION: order value in paise above which shipping must be insured and an
   * unboxing video is required to support a damage claim.
   */
  readonly insuredShippingThresholdPaise: number;
  /**
   * DECISION: auction results are binding except on authenticity.
   * Standard at auction. Allowing condition-based returns on auction lots
   * invites bidders to reconsider after winning.
   */
  readonly auctionSalesFinalExceptAuthenticity: boolean;
  /** Hours after placing an order in which a buyer may cancel unilaterally. */
  readonly freeCancellationHours: number;
}

export const REFUND_POLICY: RefundPolicy = {
  inspectionWindowDays: 3,
  refundProcessingDays: { min: 5, max: 7 },
  acceptsChangeOfMind: false,
  // ₹25,000
  insuredShippingThresholdPaise: 2_500_000,
  auctionSalesFinalExceptAuthenticity: true,
  freeCancellationHours: 24,
};

/** Rupees for display, from an integer paise amount. */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/**
 * The date this policy text was last substantively changed.
 *
 * Set by hand. A published policy has to show when it last changed, and
 * deriving it from a build timestamp would move the date on every deploy.
 */
export const POLICY_LAST_UPDATED = '2026-09-01';
