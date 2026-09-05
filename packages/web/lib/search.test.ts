import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatDayFirst, formatDayMonth, formatLongDate } from './search.ts';

/**
 * Date formatting.
 *
 * Worth pinning down because the whole premise of the site rests on it: a
 * serial of 190609 reads as 19-06-2009, and showing that as 2009-06-19 makes
 * the digits look rearranged on the one page explaining that they are not.
 */

describe('formatDayFirst', () => {
  it('writes an ISO date the way India writes dates', () => {
    assert.equal(formatDayFirst('2009-06-19'), '19-06-2009');
    assert.equal(formatDayFirst('1947-08-15'), '15-08-1947');
  });

  it('keeps the digits of the serial recognisable', () => {
    // 190609 -> 19-06-2009. The first four digits of the answer are the first
    // four of the serial; that is the point of the format.
    assert.ok(formatDayFirst('2009-06-19').startsWith('19-06'));
  });

  it('zero-pads so a column lines up and 9 June is not read as September', () => {
    assert.equal(formatDayFirst('2019-06-09'), '09-06-2019');
    assert.equal(formatDayFirst('2001-01-01'), '01-01-2001');
  });

  it('handles the nineteenth century as readily as the twenty-first', () => {
    assert.equal(formatDayFirst('1909-06-19'), '19-06-1909');
    assert.equal(formatDayFirst('1869-10-02'), '02-10-1869');
  });

  it('returns anything unparseable untouched rather than inventing a date', () => {
    assert.equal(formatDayFirst('not-a-date'), 'not-a-date');
    assert.equal(formatDayFirst(''), '');
    assert.equal(formatDayFirst('--06-19'), '--06-19');
  });
});

describe('formatDayMonth', () => {
  it('puts the day first, like the full form', () => {
    assert.equal(formatDayMonth(19, 6), '19-06');
    assert.equal(formatDayMonth(9, 6), '09-06');
    assert.equal(formatDayMonth(1, 12), '01-12');
  });
});

describe('formatLongDate', () => {
  it('still spells the month out where there is room for it', () => {
    assert.equal(formatLongDate('1947-08-15'), '15 August 1947');
  });
});
