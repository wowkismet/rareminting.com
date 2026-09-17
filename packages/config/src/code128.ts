/**
 * Code 128 barcodes, as bar widths.
 *
 * Written rather than pulled in, for three reasons. It is about eighty lines
 * and a lookup table. A barcode on a delivery label is read by a hand scanner
 * in a warehouse, so "probably right" is not a standard it can be held to —
 * and something this small can be tested exhaustively against the spec's own
 * invariants. And the alternative is a runtime dependency in the render path
 * of a page that has to print reliably on a machine nobody here controls.
 *
 * This produces widths, not pixels and not an image. What draws them — SVG on
 * screen, SVG on paper — is the caller's business.
 *
 * Code Set B throughout: it covers the full printable ASCII range, which is
 * what order numbers (RM-MU5FN5OI-R6Y) and courier AWBs need. Code Set C
 * would pack pairs of digits more tightly, and is not worth the branch for
 * labels that are read once.
 */

/**
 * The 107 symbols of Code 128, as element widths.
 *
 * Each string is six alternating bar/space widths beginning with a bar and
 * summing to eleven modules — except the stop symbol, which carries a seventh
 * element and thirteen modules. Those two invariants are checked by the test
 * suite rather than trusted, because a single transposed digit in this table
 * produces a barcode that scans as the wrong character.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const;

/** Start in Code Set B. */
const START_B = 104;
const STOP = 106;

/** The widest printable range Code Set B covers. */
const MIN_CHAR = 32;
const MAX_CHAR = 126;

export interface Barcode {
  /**
   * Alternating bar and space widths in modules, starting with a bar.
   * A renderer walks these, filling the odd ones.
   */
  readonly widths: readonly number[];
  /** Total modules, which is what a viewBox is sized against. */
  readonly modules: number;
  /** The text encoded, for the human-readable line under the bars. */
  readonly text: string;
}

/** Anything Code Set B cannot carry, replaced so a label still prints. */
export function code128Safe(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code >= MIN_CHAR && code <= MAX_CHAR ? ch : '-';
  }
  return out;
}

/**
 * Encode text as Code 128B.
 *
 * Throws on empty input rather than returning an unscannable stub: a label
 * with a barcode that reads as nothing is worse than a label with none, since
 * the first is trusted and the second is obviously wrong.
 */
export function code128(text: string): Barcode {
  const safe = code128Safe(text);
  if (safe.length === 0) {
    throw new Error('A barcode needs something to encode.');
  }

  const values: number[] = [START_B];
  for (const ch of safe) {
    // Code Set B: the value is the character's offset from space.
    values.push(ch.charCodeAt(0) - MIN_CHAR);
  }

  // The checksum weights each data symbol by its position, starting at one.
  // The start symbol counts once, which is why the sum seeds with it.
  let sum = START_B;
  for (let i = 1; i < values.length; i += 1) {
    sum += (values[i] as number) * i;
  }
  values.push(sum % 103);
  values.push(STOP);

  const widths: number[] = [];
  for (const value of values) {
    const pattern = PATTERNS[value];
    if (pattern === undefined) {
      throw new Error(`No Code 128 symbol for value ${value}.`);
    }
    for (const digit of pattern) widths.push(Number(digit));
  }

  return {
    widths,
    modules: widths.reduce((total, w) => total + w, 0),
    text: safe,
  };
}
