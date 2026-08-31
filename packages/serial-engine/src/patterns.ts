/**
 * Fancy-number taxonomy.
 *
 * A serial can carry several tags at once — `112211` is simultaneously a radar
 * and a double-pair — so classification returns a list, never a single class.
 * Each tag carries a rarity weight that the pricing engine consumes directly.
 *
 * Everything here is pure and deterministic. Nothing in this module needs the
 * clock, the database or the network.
 */

import type {
  PatternCode,
  PatternEngineConfig,
  PatternEngineConfigOverrides,
  PatternEngineOptions,
  PatternTag,
} from './types.ts';
import {
  digitAt,
  distinctDigits,
  hammingDistance,
  isAllDigits,
  maxDigitFrequency,
  properDivisors,
  reverse,
  runLengths,
  toDigitArray,
} from './digits.ts';

export const DEFAULT_PATTERN_CONFIG: PatternEngineConfig = {
  // Ordering follows the spec's rank: solid > radar > ladder > repeater > semi-fancy.
  weights: {
    SOLID: 1.0,
    RADAR: 0.9,
    LADDER_DESC: 0.82,
    LADDER_ASC: 0.8,
    LADDER_DESC_WRAP: 0.55,
    LADDER_ASC_WRAP: 0.53,
    REPEATER: 0.7,
    TRIPLE_PAIRS: 0.66,
    DOUBLE_PAIRS: 0.6,
    LOW_SERIAL: 0.85,
    HIGH_SERIAL: 0.7,
    BINARY: 0.5,
    LUCKY: 0.5,
    NOVELTY: 0.4,
    SEMI_FANCY: 0.3,
    STAR_SERIES: 0.45,
    ERROR_NOTE: 0.8,
  },
  // Spec bands: 000001–000100. Adding a wider band is a config change, not a
  // code change — dealers in some markets price up to 001000.
  lowSerialBands: [
    { max: 9, tier: 1, weight: 0.95 },
    { max: 99, tier: 2, weight: 0.85 },
    { max: 100, tier: 3, weight: 0.7 },
  ],
  luckyTokens: [
    { token: '786', label: '786 — Bismillah', weight: 0.7 },
    { token: '1008', label: '1008 — sacred number', weight: 0.6 },
    { token: '108', label: '108 — sacred number', weight: 0.6 },
    { token: '777', label: '777 — triple luck', weight: 0.6 },
    { token: '111', label: '111 — unity', weight: 0.5 },
  ],
  noveltyTokens: [
    { token: '1947', label: '1947 — year of Independence', weight: 0.55 },
    { token: '1857', label: '1857 — first war of independence', weight: 0.45 },
    { token: '420', label: '420 — novelty', weight: 0.35 },
    { token: '007', label: '007 — novelty', weight: 0.35 },
  ],
  suffixMatchFactor: 0.75,
  containsMatchFactor: 0.5,
};

function mergeConfig(overrides: PatternEngineConfigOverrides | undefined): PatternEngineConfig {
  if (overrides === undefined) return DEFAULT_PATTERN_CONFIG;
  return {
    ...DEFAULT_PATTERN_CONFIG,
    ...overrides,
    weights: { ...DEFAULT_PATTERN_CONFIG.weights, ...overrides.weights },
  };
}

/* -------------------------------------------------------------------------- */
/* Structural predicates                                                      */
/* -------------------------------------------------------------------------- */

/** All digits identical: `777777`. */
export function isSolid(digits: string): boolean {
  return digits.length > 1 && distinctDigits(digits).size === 1;
}

/** Reads the same both ways and is not simply solid: `123321`. */
export function isRadar(digits: string): boolean {
  return digits.length >= 3 && !isSolid(digits) && digits === reverse(digits);
}

type LadderKind = 'asc' | 'desc' | 'asc-wrap' | 'desc-wrap' | null;

/**
 * Consecutive run detection.
 *
 * A wrapping ladder (`890123`) is a genuine but distinctly weaker pattern than a
 * clean one (`123456`), so the two are reported separately.
 */
export function ladderKind(digits: string): LadderKind {
  if (digits.length < 3) return null;
  const values = toDigitArray(digits);

  let asc = true;
  let desc = true;
  let ascWrap = true;
  let descWrap = true;

  for (let i = 1; i < values.length; i += 1) {
    const previous = digitAt(values, i - 1);
    const current = digitAt(values, i);
    if (current !== previous + 1) asc = false;
    if (current !== previous - 1) desc = false;
    if (current !== (previous + 1) % 10) ascWrap = false;
    if (current !== (previous + 9) % 10) descWrap = false;
  }

  if (asc) return 'asc';
  if (desc) return 'desc';
  if (ascWrap) return 'asc-wrap';
  if (descWrap) return 'desc-wrap';
  return null;
}

/**
 * Length of the shortest block that tiles the serial.
 *
 * `123123` → 3, `121212` → 2, `777777` → 1, `150892` → 6 (no repetition).
 */
export function smallestRepeatingBlock(digits: string): number {
  const n = digits.length;
  for (const size of [1, ...properDivisors(n)]) {
    const block = digits.slice(0, size);
    if (block.repeat(n / size) === digits) return size;
  }
  return n;
}

/** Every run of equal digits has the same length ≥ 2: `112233`, `111222`. */
function uniformRunLength(digits: string): number | null {
  const runs = runLengths(digits);
  if (runs.length < 2) return null;
  const first = runs[0];
  if (first === undefined || first.length < 2) return null;
  return runs.every((run) => run.length === first.length) ? first.length : null;
}

/* -------------------------------------------------------------------------- */
/* Distance to the nearest premium pattern (drives SEMI_FANCY)                */
/* -------------------------------------------------------------------------- */

/** Non-wrapping ladders of a given length. Empty for lengths above 10. */
function ladderCandidates(length: number): string[] {
  if (length < 3 || length > 10) return [];
  const out: string[] = [];
  for (let start = 0; start + length - 1 <= 9; start += 1) {
    let value = '';
    for (let i = 0; i < length; i += 1) value += String(start + i);
    out.push(value);
  }
  for (let start = length - 1; start <= 9; start += 1) {
    let value = '';
    for (let i = 0; i < length; i += 1) value += String(start - i);
    out.push(value);
  }
  return out;
}

function distanceToSolid(digits: string): number {
  return digits.length - maxDigitFrequency(digits);
}

function distanceToRadar(digits: string): number {
  let distance = 0;
  for (let i = 0; i < Math.floor(digits.length / 2); i += 1) {
    if (digits.charAt(i) !== digits.charAt(digits.length - 1 - i)) distance += 1;
  }
  return distance;
}

function distanceToLadder(digits: string): number {
  const candidates = ladderCandidates(digits.length);
  if (candidates.length === 0) return Number.POSITIVE_INFINITY;
  return candidates.reduce(
    (best, candidate) => Math.min(best, hammingDistance(digits, candidate)),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Edits needed to turn the serial into some repeater.
 *
 * For each block size, each position within the block is fixed independently by
 * keeping its most common digit across repetitions.
 */
function distanceToRepeater(digits: string): number {
  const n = digits.length;
  let best = Number.POSITIVE_INFINITY;

  for (const size of properDivisors(n)) {
    let kept = 0;
    for (let position = 0; position < size; position += 1) {
      const counts = new Map<string, number>();
      let localBest = 0;
      for (let index = position; index < n; index += size) {
        const char = digits.charAt(index);
        const next = (counts.get(char) ?? 0) + 1;
        counts.set(char, next);
        if (next > localBest) localBest = next;
      }
      kept += localBest;
    }
    best = Math.min(best, n - kept);
  }
  return best;
}

export interface NearestPremium {
  readonly distance: number;
  readonly pattern: 'solid' | 'radar' | 'ladder' | 'repeater' | null;
}

/** How many single-digit edits separate this serial from a premium pattern. */
export function nearestPremiumPattern(digits: string): NearestPremium {
  const measured: readonly { pattern: NonNullable<NearestPremium['pattern']>; distance: number }[] = [
    { pattern: 'solid', distance: distanceToSolid(digits) },
    { pattern: 'radar', distance: distanceToRadar(digits) },
    { pattern: 'ladder', distance: distanceToLadder(digits) },
    { pattern: 'repeater', distance: distanceToRepeater(digits) },
  ];

  let best: NearestPremium = { distance: Number.POSITIVE_INFINITY, pattern: null };
  for (const entry of measured) {
    if (entry.distance < best.distance) best = { distance: entry.distance, pattern: entry.pattern };
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

function tag(
  code: PatternCode,
  label: string,
  weight: number,
  detail: string | null,
  tier: number | null,
): PatternTag {
  return { code, label, weight, detail, tier };
}

function matchTokens(
  digits: string,
  tokens: PatternEngineConfig['luckyTokens'],
  code: PatternCode,
  config: PatternEngineConfig,
): PatternTag[] {
  const out: PatternTag[] = [];
  for (const entry of tokens) {
    let factor: number;
    let how: string;
    if (digits === entry.token) {
      factor = 1;
      how = 'the entire serial';
    } else if (digits.endsWith(entry.token)) {
      factor = config.suffixMatchFactor;
      how = 'ends the serial';
    } else if (digits.includes(entry.token)) {
      factor = config.containsMatchFactor;
      how = 'appears in the serial';
    } else {
      continue;
    }
    out.push(tag(code, entry.label, Math.min(1, entry.weight * factor), `${entry.token} ${how}`, null));
  }
  return out;
}

/**
 * Classify a digit block against the full fancy-number taxonomy.
 *
 * `ERROR_NOTE` is never produced here — printing errors are not visible in the
 * serial and are supplied by image analysis or manual review.
 */
export function classifyPatterns(
  digits: string,
  options: PatternEngineOptions = {},
): PatternTag[] {
  if (!isAllDigits(digits)) {
    throw new TypeError(`Expected a digit block, received ${JSON.stringify(digits)}`);
  }
  const config = mergeConfig(options.config);
  const weights = config.weights;
  const tags: PatternTag[] = [];
  const n = digits.length;

  if (isSolid(digits)) {
    tags.push(tag('SOLID', 'Solid', weights.SOLID, `all ${n} digits are ${digits.charAt(0)}`, null));
  }

  if (isRadar(digits)) {
    tags.push(tag('RADAR', 'Radar / palindrome', weights.RADAR, 'reads identically in both directions', null));
  }

  const ladder = ladderKind(digits);
  if (ladder === 'asc') {
    tags.push(tag('LADDER_ASC', 'Ascending ladder', weights.LADDER_ASC, 'each digit is one more than the last', null));
  } else if (ladder === 'desc') {
    tags.push(tag('LADDER_DESC', 'Descending ladder', weights.LADDER_DESC, 'each digit is one less than the last', null));
  } else if (ladder === 'asc-wrap') {
    tags.push(tag('LADDER_ASC_WRAP', 'Ascending ladder (wrapping)', weights.LADDER_ASC_WRAP, 'ascends through 9 back to 0', null));
  } else if (ladder === 'desc-wrap') {
    tags.push(tag('LADDER_DESC_WRAP', 'Descending ladder (wrapping)', weights.LADDER_DESC_WRAP, 'descends through 0 back to 9', null));
  }

  const block = smallestRepeatingBlock(digits);
  if (block > 1 && block < n) {
    tags.push(
      tag('REPEATER', 'Repeater', weights.REPEATER, `block of ${block} repeated ${n / block} times`, null),
    );
  }

  const runLength = uniformRunLength(digits);
  if (runLength === 2) {
    tags.push(tag('DOUBLE_PAIRS', 'Double pairs', weights.DOUBLE_PAIRS, 'every digit appears twice in a row', null));
  } else if (runLength === 3) {
    tags.push(tag('TRIPLE_PAIRS', 'Triple pairs', weights.TRIPLE_PAIRS, 'every digit appears three times in a row', null));
  }

  const value = Number.parseInt(digits, 10);
  if (value > 0) {
    for (const band of config.lowSerialBands) {
      if (value <= band.max) {
        tags.push(
          tag('LOW_SERIAL', 'Low serial', band.weight, `serial number ${value}`, band.tier),
        );
        break;
      }
    }
  }

  const maximum = 10 ** n - 1;
  if (value >= maximum - 9) {
    tags.push(
      tag(
        'HIGH_SERIAL',
        'High serial',
        weights.HIGH_SERIAL,
        value === maximum ? 'the highest serial in the run' : `within 10 of the highest serial`,
        value === maximum ? 1 : 2,
      ),
    );
  }

  if (distinctDigits(digits).size === 2) {
    tags.push(
      tag('BINARY', 'Binary', weights.BINARY, `built from just ${[...distinctDigits(digits)].sort().join(' and ')}`, null),
    );
  }

  tags.push(...matchTokens(digits, config.luckyTokens, 'LUCKY', config));
  tags.push(...matchTokens(digits, config.noveltyTokens, 'NOVELTY', config));

  const nearest = nearestPremiumPattern(digits);
  if (nearest.distance === 1 && nearest.pattern !== null) {
    tags.push(
      tag(
        'SEMI_FANCY',
        'Semi-fancy',
        weights.SEMI_FANCY,
        `one digit away from a ${nearest.pattern}`,
        null,
      ),
    );
  }

  return tags.sort((a, b) => b.weight - a.weight);
}

/**
 * Collapse a tag list into a single 0–1 rarity score.
 *
 * Probabilistic OR, with secondary tags heavily damped: the strongest pattern
 * should dominate, and a pile of weak tags must never out-rank a solid.
 */
export function rarityScore(tags: readonly PatternTag[], secondaryDamping = 0.25): number {
  const sorted = [...tags].sort((a, b) => b.weight - a.weight);
  let complement = 1;
  sorted.forEach((entry, index) => {
    const effective = index === 0 ? entry.weight : entry.weight * secondaryDamping;
    complement *= 1 - Math.max(0, Math.min(1, effective));
  });
  return 1 - complement;
}
