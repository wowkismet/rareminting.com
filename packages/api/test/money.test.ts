import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBps,
  computeBreakdown,
  DEFAULT_RATES,
  formatInr,
  type Rates,
} from '../src/money.ts';

/**
 * Money arithmetic.
 *
 * These are the numbers that end up on an invoice and in a payout, so the tests
 * are written against amounts a person can check by hand.
 */

const RATES: Rates = {
  takeRateBps: 1000, // 10%
  listingFeePaise: 0,
  buyerPremiumBps: 0,
  gstRateBps: 1800, // 18%
  tdsRateBps: 100, // 1%
};

describe('applyBps', () => {
  it('applies a percentage', () => {
    assert.equal(applyBps(1_000_00, 1000), 10_000); // 10% of ₹1000 = ₹100
    assert.equal(applyBps(450_000, 1800), 81_000); // 18% of ₹4500 = ₹810
  });

  it('rounds to whole paise rather than leaving a fraction', () => {
    // 1% of 333 paise is 3.33 paise, which cannot exist.
    assert.equal(applyBps(333, 100), 3);
    assert.equal(Number.isInteger(applyBps(12_345, 1234)), true);
  });

  it('is zero at a zero rate', () => {
    assert.equal(applyBps(999_999, 0), 0);
  });

  it('refuses a fractional amount, which would mean a float crept in', () => {
    assert.throws(() => applyBps(100.5, 1000), TypeError);
  });

  it('refuses a negative rate', () => {
    assert.throws(() => applyBps(1000, -100), RangeError);
  });
});

describe('a ₹4,500 sale at 10% commission', () => {
  const b = computeBreakdown({ subtotalPaise: 450_000, rates: RATES });

  it('charges the buyer exactly the item price when there is no shipping or premium', () => {
    assert.equal(b.totalPaise, 450_000);
  });

  it('takes ₹450 commission', () => {
    assert.equal(b.commissionPaise, 45_000);
  });

  it('adds 18% GST on the commission, not on the sale', () => {
    assert.equal(b.gstOnCommissionPaise, 8_100); // 18% of ₹450 = ₹81
  });

  it('withholds 1% TDS on the seller gross', () => {
    assert.equal(b.tdsPaise, 4_500); // 1% of ₹4500 = ₹45
  });

  it('pays the seller ₹3,924', () => {
    // 4500 − 450 − 81 − 45 = 3924
    assert.equal(b.sellerPayoutPaise, 392_400);
  });

  it('balances: nothing appears or disappears', () => {
    assert.equal(
      b.subtotalPaise,
      b.sellerPayoutPaise + b.commissionPaise + b.gstOnCommissionPaise + b.tdsPaise,
    );
  });
});

describe('shipping and buyer premium', () => {
  it('adds shipping to the buyer total but not to commission', () => {
    const b = computeBreakdown({
      subtotalPaise: 100_000,
      shippingPaise: 15_000,
      rates: RATES,
    });
    assert.equal(b.totalPaise, 115_000);
    assert.equal(b.commissionPaise, 10_000, 'commission is on the item, not the postage');
  });

  it('adds an auction buyer premium on top of the hammer price', () => {
    const b = computeBreakdown({
      subtotalPaise: 100_000,
      rates: { ...RATES, buyerPremiumBps: 1000 },
    });
    assert.equal(b.buyerPremiumPaise, 10_000);
    assert.equal(b.totalPaise, 110_000);
    assert.equal(b.sellerPayoutPaise, 100_000 - 10_000 - 1_800 - 1_000);
  });
});

describe('everything stays in whole paise', () => {
  it('never produces a fraction, at any price', () => {
    for (const subtotal of [1, 7, 99, 333, 12_345, 450_000, 99_999_999]) {
      const b = computeBreakdown({ subtotalPaise: subtotal, rates: RATES });
      for (const [name, value] of Object.entries(b)) {
        assert.equal(Number.isInteger(value), true, `${name} was ${value} for subtotal ${subtotal}`);
      }
    }
  });

  it('never pays out more than the sale price', () => {
    for (const subtotal of [1, 100, 5_000, 450_000]) {
      const b = computeBreakdown({ subtotalPaise: subtotal, rates: RATES });
      assert.ok(b.sellerPayoutPaise <= b.subtotalPaise);
      assert.ok(b.sellerPayoutPaise >= 0);
    }
  });
});

describe('guards', () => {
  it('refuses a zero or negative sale', () => {
    assert.throws(() => computeBreakdown({ subtotalPaise: 0, rates: RATES }), RangeError);
    assert.throws(() => computeBreakdown({ subtotalPaise: -100, rates: RATES }), RangeError);
  });

  it('refuses a fractional subtotal', () => {
    assert.throws(() => computeBreakdown({ subtotalPaise: 100.5, rates: RATES }), RangeError);
  });

  it('refuses rates that would leave the seller owing money', () => {
    assert.throws(
      () =>
        computeBreakdown({
          subtotalPaise: 10_000,
          rates: { ...RATES, takeRateBps: 9000, listingFeePaise: 5_000 },
        }),
      /must never owe money/,
    );
  });

  it('handles a flat listing fee', () => {
    const b = computeBreakdown({
      subtotalPaise: 100_000,
      rates: { ...RATES, listingFeePaise: 2_000 },
    });
    assert.equal(b.commissionPaise, 12_000, '10% plus the ₹20 flat fee');
  });
});

describe('display formatting', () => {
  it('uses Indian digit grouping', () => {
    assert.equal(formatInr(450_000), '₹4,500');
    assert.equal(formatInr(10_000_000), '₹1,00,000');
  });

  it('shows paise only when there are any', () => {
    assert.equal(formatInr(100), '₹1');
    assert.equal(formatInr(150), '₹1.50');
  });
});

describe('default rates', () => {
  it('are conservative rather than free', () => {
    assert.ok(DEFAULT_RATES.takeRateBps > 0, 'a missing rule must not mean a free sale');
    const b = computeBreakdown({ subtotalPaise: 450_000, rates: DEFAULT_RATES });
    assert.ok(b.commissionPaise > 0);
    assert.ok(b.sellerPayoutPaise < b.subtotalPaise);
  });
});
