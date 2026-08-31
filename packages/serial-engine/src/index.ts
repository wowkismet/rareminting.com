/**
 * `@rareminting/serial-engine`
 *
 * Parses a banknote serial number, reads every plausible date out of it, and
 * classifies it against the fancy-number taxonomy. Pure, deterministic and
 * dependency-free: the API service, the OCR service and the pricing engine all
 * consume this same library so that a serial is never interpreted two different
 * ways in two different places.
 */

import type {
  AnalyzeOptions,
  DateEngineOptions,
  PatternEngineOptions,
  PatternTag,
  SerialAnalysis,
} from './types.ts';
import { parseSerial } from './serial.ts';
import { interpretSerialDates } from './dates.ts';
import { DEFAULT_PATTERN_CONFIG, classifyPatterns, rarityScore } from './patterns.ts';

export type * from './types.ts';

export {
  normalizeSerialInput,
  parseSerial,
  serialRegistryKey,
} from './serial.ts';

export {
  DEFAULT_DATE_CONFIG,
  daysInMonth,
  interpretSerialDates,
  isLeapYear,
  isValidCalendarDate,
} from './dates.ts';

export {
  DEFAULT_PATTERN_CONFIG,
  classifyPatterns,
  isRadar,
  isSolid,
  ladderKind,
  nearestPremiumPattern,
  rarityScore,
  smallestRepeatingBlock,
} from './patterns.ts';

export {
  buildPairPlan,
  findMatchedPairs,
  pairRoleFor,
} from './pairs.ts';

export { digitalRoot } from './digits.ts';

/**
 * Full analysis of a raw serial: parse, date readings, pattern tags, rarity.
 *
 * Returns `null` when the serial cannot be parsed — the caller decides whether
 * that means a validation error for a human seller or a review-queue entry for
 * the OCR pipeline.
 */
export function analyzeSerial(raw: string, options: AnalyzeOptions = {}): SerialAnalysis | null {
  const parsed = parseSerial(raw, options);
  if (!parsed.ok) return null;

  const { serial, warnings } = parsed;

  // Built with conditional spreads: `exactOptionalPropertyTypes` forbids
  // assigning an explicit `undefined` to an optional property.
  const dateOptions: DateEngineOptions = {
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.dateConfig !== undefined ? { config: options.dateConfig } : {}),
  };
  const patternOptions: PatternEngineOptions =
    options.patternConfig !== undefined ? { config: options.patternConfig } : {};

  const dates = interpretSerialDates(serial.serialDigits, dateOptions);
  const patterns: PatternTag[] = classifyPatterns(serial.serialDigits, patternOptions);

  // Star series is a property of the note, not of its digits, so it is applied
  // here rather than inside the digit classifier.
  if (serial.isStar) {
    const weights = { ...DEFAULT_PATTERN_CONFIG.weights, ...options.patternConfig?.weights };
    patterns.push({
      code: 'STAR_SERIES',
      label: 'Star series',
      weight: weights.STAR_SERIES,
      detail: 'a replacement note, printed to substitute a defective one',
      tier: null,
    });
    patterns.sort((a, b) => b.weight - a.weight);
  }

  return {
    serial,
    warnings,
    dates,
    bestDate: dates[0] ?? null,
    patterns,
    rarityScore: rarityScore(patterns),
  };
}
