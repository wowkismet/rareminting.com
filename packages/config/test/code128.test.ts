import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { code128, code128Safe } from '../src/code128.ts';

/**
 * Code 128.
 *
 * This is read by a hand scanner in a warehouse, which means a wrong barcode
 * does not look wrong — it looks fine and scans as a different parcel. So
 * rather than one golden string, these check the structural invariants the
 * specification guarantees. A single transposed digit anywhere in the pattern
 * table breaks at least one of them.
 */

describe('the symbol table', () => {
  it('gives every symbol six elements of eleven modules', () => {
    // The stop symbol is the documented exception: seven elements, thirteen
    // modules, because it carries the terminating bar.
    for (const text of ['A', 'RM-MU5FN5OI-R6Y', '0123456789']) {
      const { widths } = code128(text);

      // Every symbol but the last is six elements.
      const body = widths.slice(0, -7);
      assert.equal(body.length % 6, 0, 'symbols must be six elements each');

      for (let i = 0; i < body.length; i += 6) {
        const sum = body.slice(i, i + 6).reduce((a, b) => a + b, 0);
        assert.equal(sum, 11, `symbol at ${i} is ${sum} modules, not 11`);
      }

      const stop = widths.slice(-7);
      assert.equal(
        stop.reduce((a, b) => a + b, 0),
        13,
        'the stop symbol is thirteen modules',
      );
    }
  });

  it('uses only widths of one to four modules', () => {
    const { widths } = code128('Rare Minting 123');
    for (const w of widths) {
      assert.ok(w >= 1 && w <= 4, `width ${w} is outside the Code 128 range`);
    }
  });

  it('counts modules exactly', () => {
    // 11 per symbol, plus 2 extra for the stop's terminating bar. The symbols
    // are: start, one per character, checksum, stop.
    for (const text of ['A', 'AB', 'RM-MU5FN5OI-R6Y']) {
      const { widths, modules } = code128(text);
      const symbols = text.length + 3;
      assert.equal(modules, symbols * 11 + 2, `${text} came out the wrong length`);
      assert.equal(
        widths.reduce((a, b) => a + b, 0),
        modules,
        'the reported module count must match the widths',
      );
    }
  });

  it('starts with a bar and ends with one', () => {
    // Widths alternate bar, space, bar... so an even count would end on a
    // space and the final bar would be missing.
    const { widths } = code128('RM-TEST-1');
    assert.equal(widths.length % 2, 1, 'the pattern must end on a bar');
  });
});

describe('encoding', () => {
  it('is deterministic', () => {
    assert.deepEqual(code128('RM-MU5FN5OI-R6Y').widths, code128('RM-MU5FN5OI-R6Y').widths);
  });

  it('distinguishes strings that differ by one character', () => {
    // The checksum is position-weighted, so a transposition has to change the
    // pattern. If it did not, two parcels could scan identically.
    const a = code128('AB').widths.join('');
    const b = code128('BA').widths.join('');
    assert.notEqual(a, b, 'a transposition must not encode identically');
  });

  it('carries the real order and AWB shapes this site produces', () => {
    for (const text of ['RM-MU5FN5OI-R6Y', 'RMG-MU5FN5OE-6V2', '1234567890123']) {
      const bar = code128(text);
      assert.equal(bar.text, text, 'nothing in these needs substituting');
      assert.ok(bar.modules > 0);
    }
  });

  it('refuses to encode nothing', () => {
    // A label with a barcode that scans as nothing is worse than a label with
    // no barcode: the first is trusted, the second is obviously wrong.
    assert.throws(() => code128(''));
  });
});

describe('characters Code Set B cannot carry', () => {
  it('substitutes them rather than failing to print a label', () => {
    assert.equal(code128Safe('RM 123'), 'RM-123');
    assert.equal(code128Safe('café'), 'caf-');
    assert.equal(code128Safe('₹500'), '-500');
  });

  it('leaves the whole printable range alone', () => {
    let all = '';
    for (let c = 32; c <= 126; c += 1) all += String.fromCharCode(c);
    assert.equal(code128Safe(all), all);
    // And it all encodes.
    assert.ok(code128(all).modules > 0);
  });
});
