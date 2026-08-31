import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPairPlan, findMatchedPairs, pairRoleFor } from '../src/index.ts';

describe('buildPairPlan', () => {
  it('splits a full date into a day-month note and a year note', () => {
    const plan = buildPairPlan(1947, 8, 15);
    assert.equal(plan.iso, '1947-08-15');
    assert.equal(plan.dayMonthFragment, '1508');
    assert.equal(plan.monthDayFragment, '0815');
    assert.equal(plan.yearFragment, '1947');
    assert.match(plan.description, /1508/);
    assert.match(plan.description, /1947/);
  });

  it('pads single-digit days and months', () => {
    const plan = buildPairPlan(2001, 1, 2);
    assert.equal(plan.dayMonthFragment, '0201');
    assert.equal(plan.monthDayFragment, '0102');
  });

  it('refuses an impossible date', () => {
    assert.throws(() => buildPairPlan(1900, 2, 29), RangeError, '1900 is not a leap year');
    assert.throws(() => buildPairPlan(1992, 13, 1), RangeError);
    assert.throws(() => buildPairPlan(1992, 4, 31), RangeError);
  });

  it('accepts 29 February in a leap year', () => {
    assert.equal(buildPairPlan(2000, 2, 29).dayMonthFragment, '2902');
  });

  it('requires a four-digit year', () => {
    assert.throws(() => buildPairPlan(47, 8, 15), RangeError);
  });
});

describe('pairRoleFor', () => {
  const plan = buildPairPlan(1947, 8, 15);

  it('matches a day-month note by its trailing digits', () => {
    assert.equal(pairRoleFor('001508', plan), 'day-month');
    assert.equal(pairRoleFor('991508', plan), 'day-month');
  });

  it('matches the US-ordered day-month fragment too', () => {
    assert.equal(pairRoleFor('000815', plan), 'day-month');
  });

  it('matches a year note by its trailing digits', () => {
    assert.equal(pairRoleFor('001947', plan), 'year');
  });

  it('does not match a fragment that merely appears mid-serial', () => {
    assert.equal(pairRoleFor('150800', plan), null, '1508 must land at the end');
  });

  it('returns null for an unrelated serial', () => {
    assert.equal(pairRoleFor('150892', plan), null);
  });

  it('rejects a non-digit block outright', () => {
    assert.throws(() => pairRoleFor('15O892', plan), TypeError);
  });
});

describe('findMatchedPairs', () => {
  const plan = buildPairPlan(1947, 8, 15);

  it('pairs a day-month note with a year note', () => {
    const pairs = findMatchedPairs(['001508', '001947', '150892'], plan);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]?.dayMonth.digits, '001508');
    assert.equal(pairs[0]?.year.digits, '001947');
  });

  it('returns nothing when only one side is in stock', () => {
    assert.deepEqual(findMatchedPairs(['001508', '001508'], plan), []);
  });

  it('is limited by the scarcer side', () => {
    const pairs = findMatchedPairs(['001508', '111508', '221508', '001947'], plan);
    assert.equal(pairs.length, 1);
  });

  it('ignores serials that fill neither role', () => {
    assert.deepEqual(findMatchedPairs(['150892', '777777'], plan), []);
  });
});
