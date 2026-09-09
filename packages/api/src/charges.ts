/**
 * What a basket costs beyond the notes in it.
 *
 * Every figure here is in paise and every calculation is integer arithmetic.
 * A rupee amount that has been through a float is a rupee amount that will
 * eventually be a paisa out, and these numbers appear on an invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE TWO NUMBERS TO CHANGE ARE AT THE TOP OF THIS FILE.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const CHARGES = {
  /** ₹60 a delivery. One charge per seller, because each posts their own parcel. */
  deliveryPerSellerPaise: 60_00,

  /**
   * Free delivery above this.
   *
   * Not specified when this was asked for, so ₹5,000 is a guess — high enough
   * that it is not free on every order, low enough to reach on one good note.
   * Change it here and nowhere else.
   */
  freeDeliveryAbovePaise: 5_000_00,

  /** Insurance, optional, as a share of the declared value. 0.5% = 50 bps. */
  insuranceBps: 50,

  /** The least an insurance premium can be, so a small one is not ₹2. */
  minInsurancePaise: 25_00,

  /**
   * Gift packaging, per order.
   *
   * Also unspecified. ₹149 covers a box and a card without being the reason
   * somebody abandons a basket.
   */
  giftPackingPaise: 149_00,
} as const;

/** Basis points of an amount, rounded half-up, in integers throughout. */
export function bps(amountPaise: number, points: number): number {
  return Math.round((amountPaise * points) / 10_000);
}

export interface ChargeInput {
  /** The notes themselves, before anything is added. */
  subtotalPaise: number;
  /** How many sellers are in the basket — each posts separately. */
  sellerCount: number;
  wantsInsurance: boolean;
  wantsGiftPacking: boolean;
}

export interface Charges {
  subtotalPaise: number;
  deliveryPaise: number;
  insurancePaise: number;
  giftPaise: number;
  /** Before any coupon. */
  beforeDiscountPaise: number;
  /** True when delivery was waived, so the page can say so. */
  deliveryWaived: boolean;
}

/**
 * Work out the charges on a basket.
 *
 * Delivery is per seller rather than per basket: three sellers means three
 * parcels, three labels and three journeys, and charging one fee for that
 * loses money on exactly the baskets a marketplace wants most.
 */
export function computeCharges(input: ChargeInput): Charges {
  const { subtotalPaise, sellerCount, wantsInsurance, wantsGiftPacking } = input;

  const waived = subtotalPaise >= CHARGES.freeDeliveryAbovePaise;
  const deliveryPaise = waived
    ? 0
    : CHARGES.deliveryPerSellerPaise * Math.max(sellerCount, 1);

  const insurancePaise = wantsInsurance
    ? Math.max(bps(subtotalPaise, CHARGES.insuranceBps), CHARGES.minInsurancePaise)
    : 0;

  const giftPaise = wantsGiftPacking ? CHARGES.giftPackingPaise : 0;

  return {
    subtotalPaise,
    deliveryPaise,
    insurancePaise,
    giftPaise,
    beforeDiscountPaise: subtotalPaise + deliveryPaise + insurancePaise + giftPaise,
    deliveryWaived: waived,
  };
}

export interface CouponRule {
  kind: 'percent' | 'fixed';
  /** Basis points for a percentage, paise for a fixed amount. */
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
}

/**
 * What a coupon takes off.
 *
 * Applied to the notes only, never to delivery or insurance. A discount that
 * eats the delivery charge means paying a courier out of the platform's
 * margin, and one that eats an insurance premium means holding cover that was
 * not paid for.
 *
 * Never returns more than the subtotal: a coupon worth more than the basket
 * would otherwise produce a negative total, which is a refund nobody
 * authorised.
 */
export function computeDiscount(rule: CouponRule, subtotalPaise: number): number {
  if (subtotalPaise < rule.minOrderPaise) return 0;

  const raw = rule.kind === 'percent' ? bps(subtotalPaise, rule.value) : rule.value;
  const capped = rule.maxDiscountPaise === null ? raw : Math.min(raw, rule.maxDiscountPaise);
  return Math.max(0, Math.min(capped, subtotalPaise));
}
