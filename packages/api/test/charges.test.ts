import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bps, CHARGES, computeCharges, computeDiscount } from '../src/charges.ts';

/**
 * Charges and coupons.
 *
 * All of this is money a buyer sees on a checkout page and is then charged, so
 * the arithmetic is worth pinning down rather than trusting. Every figure is
 * paise, and every one of these assertions is an integer.
 */

const charge = (
  subtotalPaise: number,
  sellerCount = 1,
  wantsInsurance = false,
  wantsGiftPacking = false,
) => computeCharges({ subtotalPaise, sellerCount, wantsInsurance, wantsGiftPacking });

describe('bps', () => {
  it('takes a percentage in integers', () => {
    assert.equal(bps(100_00, 50), 50); // 0.5% of ₹100 = ₹0.50
    assert.equal(bps(20_000_00, 50), 100_00); // 0.5% of ₹20,000 = ₹100
  });

  it('rounds rather than truncating', () => {
    // 0.5% of ₹1.01 is 0.505 paise — a truncation here loses money on every
    // small order, which nobody notices until the year end.
    assert.equal(bps(101, 50), 1);
  });
});

describe('delivery', () => {
  it('is ₹60 for one seller', () => {
    assert.equal(charge(1_000_00).deliveryPaise, 60_00);
  });

  it('is charged per seller, because each posts their own parcel', () => {
    assert.equal(charge(1_000_00, 3).deliveryPaise, 180_00);
  });

  it('is waived above the threshold', () => {
    const c = charge(CHARGES.freeDeliveryAbovePaise, 2);
    assert.equal(c.deliveryPaise, 0);
    assert.equal(c.deliveryWaived, true, 'the page needs to be able to say so');
  });

  it('is still charged a rupee below the threshold', () => {
    const c = charge(CHARGES.freeDeliveryAbovePaise - 100);
    assert.equal(c.deliveryPaise, 60_00);
    assert.equal(c.deliveryWaived, false);
  });
});

describe('insurance', () => {
  it('is nothing unless asked for', () => {
    assert.equal(charge(50_000_00).insurancePaise, 0);
  });

  it('is 0.5% of the notes', () => {
    assert.equal(charge(50_000_00, 1, true).insurancePaise, 250_00);
  });

  it('has a floor, so a small premium is not two rupees', () => {
    assert.equal(charge(1_000_00, 1, true).insurancePaise, CHARGES.minInsurancePaise);
  });
});

describe('the total', () => {
  it('adds every part exactly', () => {
    const c = charge(10_000_00, 2, true, true);
    assert.equal(
      c.beforeDiscountPaise,
      c.subtotalPaise + c.deliveryPaise + c.insurancePaise + c.giftPaise,
      'the parts must sum to the total shown',
    );
  });

  it('charges gift packing only when asked', () => {
    assert.equal(charge(1_000_00, 1, false, false).giftPaise, 0);
    assert.equal(charge(1_000_00, 1, false, true).giftPaise, CHARGES.giftPackingPaise);
  });
});

describe('coupons', () => {
  const percent = (value: number, cap: number | null, min = 0) =>
    ({ kind: 'percent', value, maxDiscountPaise: cap, minOrderPaise: min }) as const;
  const fixed = (value: number, min = 0) =>
    ({ kind: 'fixed', value, maxDiscountPaise: null, minOrderPaise: min }) as const;

  it('takes a percentage off', () => {
    assert.equal(computeDiscount(percent(1000, 5_000_00), 10_000_00), 1_000_00); // 10%
  });

  it('never exceeds its ceiling', () => {
    // 10% of ₹1,00,000 is ₹10,000, but the coupon caps at ₹500.
    assert.equal(computeDiscount(percent(1000, 500_00), 100_000_00), 500_00);
  });

  it('takes a fixed amount off', () => {
    assert.equal(computeDiscount(fixed(200_00), 5_000_00), 200_00);
  });

  it('does nothing below the minimum order', () => {
    assert.equal(computeDiscount(fixed(200_00, 5_000_00), 1_000_00), 0);
  });

  it('never exceeds the basket, so a total cannot go negative', () => {
    // A ₹500 coupon against a ₹200 note is a ₹200 discount, not a ₹300 refund.
    assert.equal(computeDiscount(fixed(500_00), 200_00), 200_00);
  });

  it('applies to the notes only, never to delivery or insurance', () => {
    // The discount is computed from the subtotal, so a basket with a large
    // delivery charge does not get a larger discount.
    const withCharges = charge(1_000_00, 5, true, true);
    assert.ok(withCharges.beforeDiscountPaise > withCharges.subtotalPaise);
    assert.equal(
      computeDiscount(percent(5000, 10_000_00), withCharges.subtotalPaise),
      500_00,
      'half of the notes, not half of the notes plus the courier',
    );
  });
});
