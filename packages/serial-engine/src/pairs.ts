/**
 * Matched pairs.
 *
 * A full `DDMMYYYY` date needs eight digits and an Indian note carries six, so
 * the complete date can only be sold as a two-note lot: one note whose digits
 * end in the day and month, one whose digits end in the year. This module turns
 * a target date into the fragments the search layer looks for.
 */

import type { PairPlan } from './types.ts';
import { isAllDigits, padDigits } from './digits.ts';
import { isValidCalendarDate } from './dates.ts';

/**
 * Describe the two notes needed to express a full date.
 *
 * @throws RangeError if the date is not a real calendar date.
 */
export function buildPairPlan(year: number, month: number, day: number): PairPlan {
  if (!isValidCalendarDate(year, month, day)) {
    throw new RangeError(`Not a valid calendar date: ${year}-${month}-${day}`);
  }
  if (year < 1000 || year > 9999) {
    throw new RangeError(`Pair plans need a four-digit year, received ${year}`);
  }

  const dayMonthFragment = `${padDigits(day, 2)}${padDigits(month, 2)}`;
  const monthDayFragment = `${padDigits(month, 2)}${padDigits(day, 2)}`;
  const yearFragment = padDigits(year, 4);
  const iso = `${yearFragment}-${padDigits(month, 2)}-${padDigits(day, 2)}`;

  return {
    iso,
    dayMonthFragment,
    monthDayFragment,
    yearFragment,
    description:
      `Two notes: one ending ${dayMonthFragment} (day and month) and one ending ${yearFragment} (year), ` +
      `which together read ${iso}.`,
  };
}

/** Which half of a pair plan, if any, a candidate serial can fill. */
export type PairRole = 'day-month' | 'year' | null;

/**
 * Test a candidate digit block against a pair plan.
 *
 * Fragments must land at the *end* of the block, which is where a reader's eye
 * goes and how dealers quote these lots.
 */
export function pairRoleFor(digits: string, plan: PairPlan): PairRole {
  if (!isAllDigits(digits)) {
    throw new TypeError(`Expected a digit block, received ${JSON.stringify(digits)}`);
  }
  if (digits.endsWith(plan.dayMonthFragment) || digits.endsWith(plan.monthDayFragment)) {
    return 'day-month';
  }
  if (digits.endsWith(plan.yearFragment)) return 'year';
  return null;
}

export interface PairCandidate {
  readonly digits: string;
  readonly role: Exclude<PairRole, null>;
}

export interface MatchedPair {
  readonly dayMonth: PairCandidate;
  readonly year: PairCandidate;
}

/**
 * Greedily pair up candidate serials that together complete the date.
 *
 * A serial that could fill either role is assigned to the scarcer side first,
 * so a single ambiguous note is not wasted on the side that already has stock.
 */
export function findMatchedPairs(
  candidates: readonly string[],
  plan: PairPlan,
): MatchedPair[] {
  const dayMonth: string[] = [];
  const years: string[] = [];

  for (const digits of candidates) {
    const role = pairRoleFor(digits, plan);
    if (role === 'day-month') dayMonth.push(digits);
    else if (role === 'year') years.push(digits);
  }

  const pairs: MatchedPair[] = [];
  const count = Math.min(dayMonth.length, years.length);
  for (let i = 0; i < count; i += 1) {
    const left = dayMonth[i];
    const right = years[i];
    if (left === undefined || right === undefined) break;
    pairs.push({
      dayMonth: { digits: left, role: 'day-month' },
      year: { digits: right, role: 'year' },
    });
  }
  return pairs;
}
