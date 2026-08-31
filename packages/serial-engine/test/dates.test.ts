import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { daysInMonth, interpretSerialDates, isLeapYear, isValidCalendarDate } from '../src/index.ts';
import type { DateEngineConfigOverrides, DateInterpretation } from '../src/index.ts';

/** Fixed clock. Era classification depends on "now", so tests must never use the real one. */
const NOW = new Date('2026-08-31T00:00:00Z');

function read(digits: string, config?: DateEngineConfigOverrides): DateInterpretation[] {
  return interpretSerialDates(digits, config === undefined ? { now: NOW } : { now: NOW, config });
}

function isoList(results: readonly DateInterpretation[]): string[] {
  return results.map((entry) => entry.iso);
}

function find(results: readonly DateInterpretation[], iso: string): DateInterpretation {
  const found = results.find((entry) => entry.iso === iso);
  assert.ok(found !== undefined, `expected an interpretation for ${iso}, got ${isoList(results).join(', ')}`);
  return found;
}

describe('calendar primitives', () => {
  it('applies the full Gregorian leap rule', () => {
    assert.equal(isLeapYear(2000), true, '2000 is divisible by 400');
    assert.equal(isLeapYear(1900), false, '1900 is a century year not divisible by 400');
    assert.equal(isLeapYear(2024), true);
    assert.equal(isLeapYear(2023), false);
    assert.equal(isLeapYear(2100), false);
  });

  it('returns the right February length', () => {
    assert.equal(daysInMonth(2000, 2), 29);
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2023, 2), 28);
  });

  it('validates month and day bounds', () => {
    assert.equal(isValidCalendarDate(1992, 8, 15), true);
    assert.equal(isValidCalendarDate(1992, 13, 1), false);
    assert.equal(isValidCalendarDate(1992, 0, 1), false);
    assert.equal(isValidCalendarDate(1992, 4, 31), false);
    assert.equal(isValidCalendarDate(1992, 8, 0), false);
    assert.equal(isValidCalendarDate(1992, 8, 32), false);
  });

  it('throws rather than guessing for an impossible month', () => {
    assert.throws(() => daysInMonth(2000, 13), RangeError);
  });
});

describe('interpretSerialDates — the primary reading', () => {
  it('reads 150892 as 15 August 1992 first', () => {
    const results = read('150892');
    const best = results[0];
    assert.ok(best !== undefined);
    assert.equal(best.iso, '1992-08-15');
    assert.ok(best.patterns.includes('DDMMYY'));
    assert.equal(best.isPartial, false);
    assert.equal(best.era, 'modern');
  });

  it('keeps leading zeros meaningful — 010125 is 1 January 2025', () => {
    const best = read('010125')[0];
    assert.ok(best !== undefined);
    assert.equal(best.iso, '2025-01-01');
    assert.equal(best.day, 1);
    assert.equal(best.month, 1);
  });

  it('ranks the Indian day-month-year convention above the US one', () => {
    const results = read('010203');
    const indian = find(results, '2003-02-01');
    const american = find(results, '2003-01-02');
    assert.ok(indian.score > american.score, 'DDMMYY must outrank MMDDYY');
    assert.ok(indian.patterns.includes('DDMMYY'));
    assert.ok(american.patterns.includes('MMDDYY'));
  });

  it('merges orders that produce the identical date', () => {
    // 05/05 reads the same day-first or month-first.
    const results = read('050592');
    const merged = find(results, '1992-05-05');
    assert.ok(merged.patterns.includes('DDMMYY'));
    assert.ok(merged.patterns.includes('MMDDYY'));
    assert.deepEqual(merged.ambiguousWith, [], 'one date only, so nothing to be ambiguous with');
    assert.equal(merged.confidence, 1);
  });
});

describe('interpretSerialDates — leap years', () => {
  it('accepts 29 February 2000 and rejects 29 February 1900', () => {
    const results = read('290200');
    assert.ok(isoList(results).includes('2000-02-29'));
    assert.ok(
      !isoList(results).includes('1900-02-29'),
      '1900 is not a leap year — this date does not exist',
    );
  });

  it('falls back to the only century in which 29 February exists', () => {
    // 2029 is beyond the future window and 2001/1901 are not leap years,
    // so DDMMYY is impossible; YYMMDD gives 1 February 1929.
    const results = read('290201');
    const fulls = results.filter((entry) => !entry.isPartial);
    assert.deepEqual(isoList(fulls), ['1929-02-01']);
    assert.ok(find(results, '1929-02-01').patterns.includes('YYMMDD'));
  });

  it('still offers 29 February as a yearless day-month reading', () => {
    // No full reading lands on 29 February, so the partial genuinely adds a
    // match a leap-day buyer would want to see.
    const partial = find(read('290201'), '--02-29');
    assert.equal(partial.isPartial, true);
    assert.equal(partial.month, 2);
    assert.equal(partial.day, 29);
  });

  it('accepts 29 February in a leap year via the ISO order', () => {
    const results = read('240229');
    assert.ok(isoList(results).includes('2024-02-29'));
  });
});

describe('interpretSerialDates — impossible dates', () => {
  it('returns nothing for a day of 32 in every order', () => {
    assert.deepEqual(read('320892'), []);
  });

  it('returns nothing for a month of 00', () => {
    assert.deepEqual(read('150092'), []);
  });

  it('returns nothing for a day of 00', () => {
    assert.deepEqual(read('000892'), []);
  });

  it('returns nothing for a month of 13 where no order rescues it', () => {
    assert.deepEqual(read('131345'), []);
  });

  it('rejects 31 April', () => {
    assert.ok(!isoList(read('310492')).includes('1992-04-31'));
  });
});

describe('interpretSerialDates — century resolution', () => {
  it('prefers the more recent century when both are plausible', () => {
    const results = read('150825');
    const recent = find(results, '2025-08-15');
    const older = find(results, '1925-08-15');
    assert.ok(recent.score > older.score);
    assert.match(recent.reasons.join(' '), /more likely of the two possible centuries/);
    assert.match(older.reasons.join(' '), /less likely of the two possible centuries/);
  });

  it('discards a century beyond the future window', () => {
    const results = read('150892');
    assert.ok(!isoList(results).includes('2092-08-15'));
    assert.match(find(results, '1992-08-15').reasons.join(' '), /2092 is outside the plausible window/);
  });

  it('keeps near-future dates, for newborns and booked weddings', () => {
    const results = read('010128');
    const future = find(results, '2028-01-01');
    assert.equal(future.era, 'future');
    assert.match(future.reasons.join(' '), /newborn or an upcoming occasion/);
  });

  it('classifies a pre-1950 date as heritage', () => {
    assert.equal(find(read('150847'), '1947-08-15').era, 'heritage');
  });

  it('classifies eras against the injected clock, not the wall clock', () => {
    const digits = '150822';
    const asOf2026 = interpretSerialDates(digits, { now: NOW });
    const asOf2100 = interpretSerialDates(digits, { now: new Date('2100-01-01T00:00:00Z') });
    assert.equal(find(asOf2026, '2022-08-15').era, 'recent');
    assert.equal(find(asOf2100, '2022-08-15').era, 'modern');
  });
});

describe('interpretSerialDates — ranking and confidence', () => {
  it('returns results sorted by descending score', () => {
    const results = read('010203');
    for (let i = 1; i < results.length; i += 1) {
      const previous = results[i - 1];
      const current = results[i];
      assert.ok(previous !== undefined && current !== undefined);
      assert.ok(previous.score >= current.score, 'results must be ranked');
    }
  });

  it('produces confidences that sum to 1', () => {
    for (const digits of ['150892', '010203', '150825', '111111']) {
      const results = read(digits);
      if (results.length === 0) continue;
      const total = results.reduce((sum, entry) => sum + entry.confidence, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${digits} confidences summed to ${total}`);
    }
  });

  it('lowers absolute score when the digits admit more than one date', () => {
    const unambiguous = find(read('050592'), '1992-05-05');
    const ambiguous = find(read('010203'), '2003-02-01');
    assert.ok(
      ambiguous.score < unambiguous.score,
      'an ambiguous serial should be less certain in absolute terms',
    );
    assert.ok(ambiguous.ambiguousWith.length > 0);
  });

  it('never reports a pattern as ambiguous with itself', () => {
    for (const entry of read('010203')) {
      for (const pattern of entry.ambiguousWith) {
        assert.ok(!entry.patterns.includes(pattern));
      }
    }
  });

  it('explains every interpretation in plain language', () => {
    for (const entry of read('150892')) {
      assert.ok(entry.reasons.length > 0);
      assert.ok(entry.reasons.every((reason) => reason.trim().length > 0));
    }
  });
});

describe('interpretSerialDates — eight-digit blocks', () => {
  it('reads a full four-digit year directly', () => {
    const results = interpretSerialDates('15081947', { now: NOW });
    const best = results[0];
    assert.ok(best !== undefined);
    assert.equal(best.iso, '1947-08-15');
    assert.ok(best.patterns.includes('DDMMYYYY'));
    assert.equal(best.era, 'heritage');
  });

  it('reads the ISO order', () => {
    const results = interpretSerialDates('19470815', { now: NOW });
    assert.ok(isoList(results).includes('1947-08-15'));
  });

  it('rejects an explicit year outside the plausible range', () => {
    const results = interpretSerialDates('15089999', { now: NOW });
    assert.deepEqual(
      results.filter((entry) => !entry.isPartial),
      [],
      'year 9999 must not produce a dated reading',
    );
    // The day-month partial survives, which is the correct fallback.
    assert.ok(results.every((entry) => entry.isPartial));
  });

  it('rejects a four-digit year below the heritage floor', () => {
    const results = interpretSerialDates('08150999', { now: NOW });
    assert.deepEqual(results.filter((entry) => !entry.isPartial), []);
  });
});

describe('interpretSerialDates — partial reads', () => {
  it('does not emit a partial that a full date already covers', () => {
    // With the default 1900 floor every two-digit year resolves, so DDMMYY
    // always wins and the DDMM partial would be pure noise.
    const results = read('150892');
    assert.ok(results.every((entry) => !entry.isPartial));
  });

  it('emits a day-month partial when no full date survives', () => {
    // minYear 1950 leaves year 45 unresolvable, and 45 is not a valid day,
    // so only the day-month reading remains.
    const results = read('251245', { minYear: 1950 });
    assert.equal(results.length, 1);
    const partial = results[0];
    assert.ok(partial !== undefined);
    assert.equal(partial.isPartial, true);
    assert.equal(partial.iso, '--12-25');
    assert.equal(partial.day, 25);
    assert.equal(partial.month, 12);
    assert.equal(partial.year, null);
    assert.equal(partial.era, null);
    assert.ok(partial.patterns.includes('DDMM'));
    assert.match(partial.reasons.join(' '), /pair this note with a year note/);
  });

  it('keeps 29 February valid as a yearless recurring day', () => {
    const results = read('290213', { minYear: 1950, includePartials: true });
    assert.ok(results.some((entry) => entry.isPartial && entry.iso === '--02-29'));
  });

  it('can be switched off', () => {
    const results = read('251245', { minYear: 1950, includePartials: false });
    assert.deepEqual(results, []);
  });
});

describe('interpretSerialDates — configurability', () => {
  it('lets an operator re-rank the reading orders without a code change', () => {
    const usFirst = read('010203', { patternPriors: { DDMMYY: 0.4, MMDDYY: 1.0 } });
    const best = usFirst[0];
    assert.ok(best !== undefined);
    assert.equal(best.iso, '2003-01-02', 'raising the MMDDYY prior must flip the ranking');
  });

  it('lets an operator widen the future window', () => {
    const narrow = read('010140', { futureYears: 2 });
    const wide = read('010140', { futureYears: 20 });
    assert.ok(!isoList(narrow).includes('2040-01-01'));
    assert.ok(isoList(wide).includes('2040-01-01'));
  });

  it('rejects a non-digit block outright', () => {
    assert.throws(() => interpretSerialDates('15O892', { now: NOW }), TypeError);
  });
});
