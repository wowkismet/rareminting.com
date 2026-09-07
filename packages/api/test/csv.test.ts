import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { csvName, csvResponse, toCsv } from '../src/csv.ts';

/**
 * CSV generation.
 *
 * The formula-injection case is the one that matters. Sellers write their own
 * titles, and an export is opened by an admin on a work machine — so a title
 * is untrusted input that ends up in a spreadsheet that will happily execute
 * it.
 */

/** The body without its byte-order mark, split into rows. */
const rows = (csv: string): string[] => csv.replace(/^﻿/, '').trimEnd().split('\r\n');

describe('toCsv', () => {
  it('writes a header and its rows', () => {
    const out = rows(toCsv(['Order', 'Total'], [['RM-1', 1200]]));
    assert.deepEqual(out, ['Order,Total', 'RM-1,1200']);
  });

  it('quotes a value containing a comma', () => {
    const out = rows(toCsv(['Title'], [['1947 Independence, Gandhi']]));
    assert.equal(out[1], '"1947 Independence, Gandhi"');
  });

  it('doubles a quote inside a value', () => {
    const out = rows(toCsv(['Title'], [['A "solid" 777777']]));
    assert.equal(out[1], '"A ""solid"" 777777"');
  });

  it('keeps a newline inside one field instead of splitting the row', () => {
    const csv = toCsv(['Note'], [['line one\nline two']]);
    assert.match(csv, /"line one\nline two"/);
    // Header, then one row that happens to contain a newline of its own.
    assert.equal(csv.replace(/^﻿/, '').split('\r\n').length, 3);
  });

  it('neutralises a formula so a spreadsheet will not run it', () => {
    for (const attack of [
      '=HYPERLINK("http://evil","Click")',
      '+1+1',
      '-1+1',
      '@SUM(A1:A9)',
    ]) {
      const out = rows(toCsv(['Title'], [[attack]]));
      const value = out[1]!;
      assert.ok(
        value.startsWith('\t') || value.startsWith('"\t'),
        `${attack} should be prefixed so it is text, got ${JSON.stringify(value)}`,
      );

      // Undo the CSV quoting to compare against what was typed. A quoted
      // field doubles its quotes, so the raw string never appears verbatim.
      const decoded = (
        value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value
      ).replace(/^\t/, '');
      assert.equal(decoded, attack, 'the reader should still see what was typed');
    }
  });

  it('leaves an ordinary value alone', () => {
    const out = rows(toCsv(['Serial'], [['9AB150892']]));
    assert.equal(out[1], '9AB150892');
  });

  it('writes an empty cell for null and undefined', () => {
    const out = rows(toCsv(['A', 'B'], [[null, undefined]]));
    assert.equal(out[1], ',');
  });

  it('starts with a byte-order mark, so Excel reads the rupee sign', () => {
    assert.ok(toCsv(['A'], [['₹1,200']]).startsWith('﻿'));
  });
});

describe('csvResponse', () => {
  it('asks the browser to download rather than display', () => {
    const res = csvResponse('report.csv', 'a,b');
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="report.csv"/);
  });

  it('will not let a filename break out of its header', () => {
    const res = csvResponse('bad"\r\nX-Evil: yes.csv', 'a');
    const header = res.headers.get('content-disposition') ?? '';
    assert.ok(!header.includes('\n') && !header.includes('"bad"'), header);
    assert.equal(res.headers.get('x-evil'), null);
  });
});

describe('csvName', () => {
  it('names the file after the report and the day', () => {
    assert.match(csvName('sellers'), /^rareminting-sellers-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
