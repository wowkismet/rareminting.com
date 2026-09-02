/**
 * Serial-number parsing.
 *
 * The parser is deliberately conservative: it recognises the layouts we know and
 * refuses everything else rather than guessing. A wrong serial is worse than an
 * unparsed one — the serial is the note's identity, its uniqueness key and the
 * thing printed on the Certificate of Authenticity.
 *
 * OCR repair is opt-in and *positional*: confusable letters are only ever
 * resolved to digits in positions the grammar already says must be digits, so a
 * prefix like `9AB` can never be mangled into `948`.
 */

import type { ParseError, ParseOptions, ParseResult, ParsedSerial, SerialFormat } from './types.ts';

/** Digit-position character class for a clean read. */
const STRICT_DIGIT = '[0-9]';

/** Digit-position class that also admits the classic OCR look-alikes. */
const LENIENT_DIGIT = '[0-9OQILZSGB]';

/** Look-alike letter → digit, applied only inside digit positions. */
const OCR_SUBSTITUTIONS: ReadonlyMap<string, string> = new Map([
  ['O', '0'],
  ['Q', '0'],
  ['I', '1'],
  ['L', '1'],
  ['Z', '2'],
  ['S', '5'],
  ['G', '6'],
  ['B', '8'],
]);

const DEFAULT_MIN_DIGITS = 1;
const DEFAULT_MAX_DIGITS = 12;

/**
 * Canonicalise whitespace, case and star glyphs.
 *
 * Note what this does *not* do: it never removes whitespace between digits.
 * `A/1 123456` would be destroyed by that, so digit-group spacing is handled
 * inside each grammar instead.
 */
export function normalizeSerialInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[∗✱★☆٭]/g, '*')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Grammar {
  readonly format: SerialFormat;
  /** Build the pattern for a given digit-position character class. */
  readonly build: (digit: string) => RegExp;
}

/**
 * Grammars are tried in order. More specific layouts must come first, otherwise
 * `GENERIC` would swallow an Indian serial and lose the prefix decomposition.
 */
const GRAMMARS: readonly Grammar[] = [
  {
    // 9AB* 150892 or 03L 190609 — MG / MG New Series.
    //
    // The three-character prefix comes in both shapes: one numeral then two
    // letters, and two numerals then one letter. Both are in circulation, and
    // accepting only the first made a great many real notes unreadable.
    //
    // Optional inset letter, optional space inside the six digits (`150 892`
    // is common on dealer sheets).
    format: 'IN_MG_NEW',
    build: (d) =>
      new RegExp(
        `^(?:([A-Z])\\s+)?(\\d[A-Z]{2}|\\d{2}[A-Z])(\\*?)[\\s-]*(${d}{3})\\s?(${d}{3})$`,
      ),
  },
  {
    // A/1 123456 — older fractional prefixes.
    format: 'IN_LEGACY',
    build: (d) => new RegExp(`^(?:([A-Z])\\s+)?([A-Z]{1,2}/\\d{1,3})(\\*?)[\\s-]*(${d}{5,7})$`),
  },
  {
    // Bare digit block, no prefix at all.
    format: 'GENERIC',
    build: (d) => new RegExp(`^()()()(${d}(?:[\\s-]*${d})*)$`),
  },
  {
    // World / pre-decimal notes: alphanumeric prefix then a digit block.
    format: 'GENERIC',
    build: (d) =>
      new RegExp(`^(?:([A-Z])\\s+)?([A-Z][A-Z0-9]{0,4}|\\d[A-Z]{1,4})(\\*?)[\\s-]*(${d}(?:[\\s-]*${d})*)$`),
  },
];

interface DigitRepair {
  readonly digits: string;
  readonly substitutions: readonly string[];
}

/** Resolve OCR look-alikes inside an already-identified digit block. */
function repairDigitBlock(block: string): DigitRepair {
  const substitutions: string[] = [];
  let digits = '';
  for (const char of block) {
    const replacement = OCR_SUBSTITUTIONS.get(char);
    if (replacement !== undefined) {
      substitutions.push(`${char}→${replacement}`);
      digits += replacement;
    } else {
      digits += char;
    }
  }
  return { digits, substitutions };
}

/** Strip the spacing that grammars allow inside a digit block. */
function compactDigits(block: string): string {
  return block.replace(/[\s-]/g, '');
}

function buildNormalized(
  inset: string | null,
  prefix: string | null,
  isStar: boolean,
  digits: string,
): string {
  const head = prefix === null ? '' : `${prefix}${isStar ? '*' : ''} `;
  const insetPart = inset === null ? '' : `${inset} `;
  return `${insetPart}${head}${digits}`;
}

interface Attempt {
  readonly serial: ParsedSerial;
  readonly warnings: readonly string[];
}

function tryGrammars(
  raw: string,
  normalized: string,
  digitClass: string,
  lenient: boolean,
  minDigits: number,
  maxDigits: number,
): Attempt | null {
  for (const grammar of GRAMMARS) {
    const match = grammar.build(digitClass).exec(normalized);
    if (match === null) continue;

    const inset = match[1] !== undefined && match[1] !== '' ? match[1] : null;
    const prefix = match[2] !== undefined && match[2] !== '' ? match[2] : null;
    const isStar = match[3] === '*';

    // IN_MG_NEW splits its six digits across two capture groups.
    const rawBlock = grammar.format === 'IN_MG_NEW'
      ? `${match[4] ?? ''}${match[5] ?? ''}`
      : (match[4] ?? '');

    const compacted = compactDigits(rawBlock);
    const warnings: string[] = [];

    let digits = compacted;
    if (lenient) {
      const repaired = repairDigitBlock(compacted);
      // Refuse a "repair" that invented every digit from letters.
      if (!/[0-9]/.test(compacted)) continue;
      if (repaired.substitutions.length > 0) {
        warnings.push(
          `OCR look-alikes resolved in the digit block: ${repaired.substitutions.join(', ')}. Confirm before publishing.`,
        );
      }
      digits = repaired.digits;
    }

    if (digits.length < minDigits || digits.length > maxDigits) continue;

    let prefixNumeral: string | null = null;
    let prefixLetters: string | null = null;
    if (grammar.format === 'IN_MG_NEW' && prefix !== null) {
      // Split where the digits stop rather than at a fixed position: the
      // numeral part is one or two characters depending on the prefix shape,
      // so slicing at index 1 would read "03L" as numeral "0", letters "3L".
      const split = /^(\d+)([A-Z]+)$/.exec(prefix);
      prefixNumeral = split?.[1] ?? null;
      prefixLetters = split?.[2] ?? null;
    }

    return {
      serial: {
        raw,
        normalized: buildNormalized(inset, prefix, isStar, digits),
        format: grammar.format,
        insetLetter: inset,
        prefix,
        prefixNumeral,
        prefixLetters,
        isStar,
        serialDigits: digits,
        serialValue: Number.parseInt(digits, 10),
        digitCount: digits.length,
      },
      warnings,
    };
  }
  return null;
}

/**
 * Parse a serial number into its component fields.
 *
 * Returns a result object rather than throwing: unparseable serials are an
 * expected, high-volume outcome of the OCR pipeline, not an exceptional one.
 */
export function parseSerial(raw: string, options: ParseOptions = {}): ParseResult {
  const minDigits = options.minDigits ?? DEFAULT_MIN_DIGITS;
  const maxDigits = options.maxDigits ?? DEFAULT_MAX_DIGITS;

  if (raw.trim() === '') {
    const error: ParseError = { code: 'EMPTY_INPUT', message: 'Serial number is empty.' };
    return { ok: false, errors: [error], warnings: [] };
  }

  const normalized = normalizeSerialInput(raw);

  const strict = tryGrammars(raw, normalized, STRICT_DIGIT, false, minDigits, maxDigits);
  if (strict !== null) {
    return { ok: true, serial: strict.serial, warnings: strict.warnings };
  }

  if (options.repairOcrConfusions === true) {
    const repaired = tryGrammars(raw, normalized, LENIENT_DIGIT, true, minDigits, maxDigits);
    if (repaired !== null) {
      return { ok: true, serial: repaired.serial, warnings: repaired.warnings };
    }
  }

  if (!/\d/.test(normalized)) {
    const error: ParseError = {
      code: 'NO_DIGITS',
      message: `No digit block found in ${JSON.stringify(raw)}.`,
    };
    return { ok: false, errors: [error], warnings: [] };
  }

  const digitCount = (normalized.match(/\d/g) ?? []).length;
  if (digitCount > maxDigits) {
    const error: ParseError = {
      code: 'DIGIT_COUNT_OUT_OF_RANGE',
      message: `Found ${digitCount} digits; the maximum accepted is ${maxDigits}.`,
    };
    return { ok: false, errors: [error], warnings: [] };
  }

  const error: ParseError = {
    code: 'UNRECOGNIZED_FORMAT',
    message: `${JSON.stringify(raw)} does not match any known serial layout.`,
  };
  return { ok: false, errors: [error], warnings: [] };
}

/**
 * Uniqueness key for the global serial registry.
 *
 * One serial, one live listing — scoped by denomination and series because the
 * same digits legitimately exist on a ₹100 and a ₹500 note.
 */
export function serialRegistryKey(
  serial: ParsedSerial,
  denomination: number,
  series: string,
): string {
  const prefix = serial.prefix ?? '-';
  const star = serial.isStar ? '*' : '';
  const inset = serial.insetLetter ?? '-';
  return [
    series.trim().toUpperCase(),
    String(denomination),
    inset,
    `${prefix}${star}`,
    serial.serialDigits,
  ].join('|');
}
