/**
 * Date interpretation.
 *
 * A six-digit serial does not encode a date — it *admits* several. `010203` is
 * validly 1 Feb 2003, 2 Jan 2003 and 3 Feb 2001. The engine therefore never
 * returns "the" date; it returns every reading that survives calendar
 * validation, each with an absolute plausibility score and a normalised
 * confidence share, ranked.
 *
 * Two rules drive most of the subtlety:
 *
 *  1. Two-digit years are ambiguous by construction. `92` could be 1992 or 2092.
 *     We resolve against a plausibility window that runs from `minYear` to a
 *     couple of years past today — the future headroom is deliberate, because
 *     expectant parents and engaged couples buy notes for dates that have not
 *     happened yet.
 *
 *  2. Leap years must be exact. `290200` is 29 Feb 2000 (valid — 2000 is a leap
 *     year under the 400-rule) but never 29 Feb 1900 (invalid — 1900 is not).
 *     Getting this wrong would put a non-existent date on a certificate.
 */

import type {
  DateEngineConfig,
  DateEngineConfigOverrides,
  DateEngineOptions,
  DateEra,
  DateInterpretation,
  DateOrderPattern,
} from './types.ts';
import { isAllDigits, padDigits } from './digits.ts';

export const DEFAULT_DATE_CONFIG: DateEngineConfig = {
  patternPriors: {
    DDMMYY: 1.0,
    MMDDYY: 0.55,
    YYMMDD: 0.5,
    DDMMYYYY: 1.0,
    MMDDYYYY: 0.55,
    YYYYMMDD: 0.6,
    DDMM: 0.3,
    MMDD: 0.18,
  },
  minYear: 1900,
  minExplicitYear: 1600,
  futureYears: 2,
  olderCenturyPenalty: 0.6,
  ambiguityPenalty: 0.85,
  eraWeights: {
    heritage: 0.9,
    historic: 0.92,
    modern: 0.96,
    recent: 1.0,
    future: 1.0,
  },
  includePartials: true,
};

const PATTERN_LABELS: Readonly<Record<DateOrderPattern, string>> = {
  DDMMYY: 'day-month-year, the standard Indian convention',
  MMDDYY: 'month-day-year, the US convention',
  YYMMDD: 'year-month-day, ISO order',
  DDMMYYYY: 'day-month-year with a full four-digit year',
  MMDDYYYY: 'month-day-year with a full four-digit year',
  YYYYMMDD: 'year-month-day with a full four-digit year',
  DDMM: 'day-month, with no year in the serial',
  MMDD: 'month-day, with no year in the serial',
};

const ERA_NOTES: Readonly<Record<DateEra, string>> = {
  heritage: 'A heritage date, before 1950.',
  historic: 'A historic date, between 1950 and 1979.',
  modern: 'A modern date.',
  recent: 'A recent date, within the last five years.',
  future: 'A future date — typically a newborn or an upcoming occasion.',
};

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Proleptic Gregorian leap rule: divisible by 4, except centuries not divisible by 400. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in `month` (1–12) of `year`. Throws for an out-of-range month. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Month out of range: ${month}`);
  }
  if (month === 2 && isLeapYear(year)) return 29;
  const days = DAYS_IN_MONTH[month - 1];
  if (days === undefined) throw new RangeError(`Month out of range: ${month}`);
  return days;
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function formatIso(year: number, month: number, day: number): string {
  return `${padDigits(year, 4)}-${padDigits(month, 2)}-${padDigits(day, 2)}`;
}

/** ISO 8601 recurring-date form for a day/month with no year. */
function formatPartialIso(month: number, day: number): string {
  return `--${padDigits(month, 2)}-${padDigits(day, 2)}`;
}

function utcStamp(year: number, month: number, day: number): number {
  const stamp = new Date(0);
  stamp.setUTCFullYear(year, month - 1, day);
  stamp.setUTCHours(0, 0, 0, 0);
  return stamp.getTime();
}

function classifyEra(year: number, month: number, day: number, now: Date): DateEra {
  const nowYear = now.getUTCFullYear();
  const today = utcStamp(nowYear, now.getUTCMonth() + 1, now.getUTCDate());
  if (utcStamp(year, month, day) > today) return 'future';
  if (year >= nowYear - 5) return 'recent';
  if (year >= 1980) return 'modern';
  if (year >= 1950) return 'historic';
  return 'heritage';
}

interface YearResolution {
  readonly year: number;
  readonly score: number;
  readonly note: string;
}

/**
 * Expand a two-digit year into every plausible century.
 *
 * Both centuries are offered when both are plausible; the more recent one wins
 * on score, because collectors overwhelmingly buy dates within living memory.
 */
function resolveTwoDigitYear(
  yearDigits: string,
  now: Date,
  config: DateEngineConfig,
): YearResolution[] {
  const value = Number.parseInt(yearDigits, 10);
  const maxYear = now.getUTCFullYear() + config.futureYears;

  const accepted: number[] = [];
  const rejected: number[] = [];
  for (const base of [2000, 1900]) {
    const year = base + value;
    if (year < config.minYear || year > maxYear) rejected.push(year);
    else accepted.push(year);
  }
  accepted.sort((a, b) => b - a);

  return accepted.map((year, index) => {
    let note: string;
    if (accepted.length === 1) {
      const other = rejected[0];
      note =
        other === undefined
          ? `Two-digit year "${yearDigits}" resolves to ${year}.`
          : `Two-digit year "${yearDigits}" resolves to ${year}; ${other} is outside the plausible window.`;
    } else if (index === 0) {
      note = `Two-digit year "${yearDigits}" read as ${year}, the more likely of the two possible centuries.`;
    } else {
      note = `Two-digit year "${yearDigits}" read as ${year}, the less likely of the two possible centuries.`;
    }
    return { year, score: index === 0 ? 1 : config.olderCenturyPenalty, note };
  });
}

interface CandidateSpec {
  readonly pattern: DateOrderPattern;
  readonly day: readonly [number, number];
  readonly month: readonly [number, number];
  readonly year: readonly [number, number] | null;
}

const SPECS_BY_LENGTH: Readonly<Record<number, readonly CandidateSpec[]>> = {
  6: [
    { pattern: 'DDMMYY', day: [0, 2], month: [2, 2], year: [4, 2] },
    { pattern: 'MMDDYY', day: [2, 2], month: [0, 2], year: [4, 2] },
    { pattern: 'YYMMDD', day: [4, 2], month: [2, 2], year: [0, 2] },
  ],
  8: [
    { pattern: 'DDMMYYYY', day: [0, 2], month: [2, 2], year: [4, 4] },
    { pattern: 'MMDDYYYY', day: [2, 2], month: [0, 2], year: [4, 4] },
    { pattern: 'YYYYMMDD', day: [6, 2], month: [4, 2], year: [0, 4] },
  ],
};

const PARTIAL_SPECS: readonly CandidateSpec[] = [
  { pattern: 'DDMM', day: [0, 2], month: [2, 2], year: null },
  { pattern: 'MMDD', day: [2, 2], month: [0, 2], year: null },
];

function slice(digits: string, spec: readonly [number, number]): string {
  return digits.slice(spec[0], spec[0] + spec[1]);
}

interface Draft {
  patterns: DateOrderPattern[];
  readonly day: number;
  readonly month: number;
  readonly year: number | null;
  readonly iso: string;
  readonly isPartial: boolean;
  score: number;
  readonly era: DateEra | null;
  readonly yearNote: string | null;
}

function mergeConfig(overrides: DateEngineConfigOverrides | undefined): DateEngineConfig {
  if (overrides === undefined) return DEFAULT_DATE_CONFIG;
  return {
    ...DEFAULT_DATE_CONFIG,
    ...overrides,
    patternPriors: { ...DEFAULT_DATE_CONFIG.patternPriors, ...overrides.patternPriors },
    eraWeights: { ...DEFAULT_DATE_CONFIG.eraWeights, ...overrides.eraWeights },
  };
}

function buildReasons(
  draft: Draft,
  config: DateEngineConfig,
  ambiguousWith: readonly DateOrderPattern[],
): string[] {
  const ordered = [...draft.patterns].sort(
    (a, b) => config.patternPriors[b] - config.patternPriors[a],
  );
  const primary = ordered[0];
  const reasons: string[] = [];

  if (primary !== undefined) {
    reasons.push(`Read as ${PATTERN_LABELS[primary]}.`);
  }
  if (ordered.length > 1) {
    const others = ordered.slice(1).map((pattern) => PATTERN_LABELS[pattern]);
    reasons.push(`The same date also results from reading it as ${others.join(', and as ')}.`);
  }
  if (draft.yearNote !== null) {
    reasons.push(draft.yearNote);
  }
  if (draft.era !== null) {
    reasons.push(ERA_NOTES[draft.era]);
  }
  if (draft.isPartial) {
    reasons.push('Day and month only — pair this note with a year note for the full date.');
  }
  if (ambiguousWith.length > 0) {
    reasons.push(
      `These digits also read as a different date under ${ambiguousWith
        .map((pattern) => PATTERN_LABELS[pattern])
        .join(', ')}.`,
    );
  }
  return reasons;
}

/**
 * Every plausible date reading of a digit block, ranked most-likely first.
 *
 * Handles 6-digit blocks (two-digit years) and 8-digit blocks (explicit
 * four-digit years). Partial day/month reads are appended only when they add
 * information no full reading already covers.
 */
export function interpretSerialDates(
  digits: string,
  options: DateEngineOptions = {},
): DateInterpretation[] {
  if (!isAllDigits(digits)) {
    throw new TypeError(`Expected a digit block, received ${JSON.stringify(digits)}`);
  }
  const config = mergeConfig(options.config);
  const now = options.now ?? new Date();
  const maxYear = now.getUTCFullYear() + config.futureYears;

  const fullDrafts = new Map<string, Draft>();

  for (const spec of SPECS_BY_LENGTH[digits.length] ?? []) {
    const day = Number.parseInt(slice(digits, spec.day), 10);
    const month = Number.parseInt(slice(digits, spec.month), 10);
    if (spec.year === null) continue;

    const yearDigits = slice(digits, spec.year);
    const resolutions: YearResolution[] =
      spec.year[1] === 4
        ? (() => {
            const year = Number.parseInt(yearDigits, 10);
            if (year < config.minExplicitYear || year > maxYear) return [];
            return [{ year, score: 1, note: `Four-digit year ${year} read directly from the serial.` }];
          })()
        : resolveTwoDigitYear(yearDigits, now, config);

    for (const resolution of resolutions) {
      if (!isValidCalendarDate(resolution.year, month, day)) continue;

      const iso = formatIso(resolution.year, month, day);
      const era = classifyEra(resolution.year, month, day, now);
      const score =
        config.patternPriors[spec.pattern] * resolution.score * config.eraWeights[era];

      const existing = fullDrafts.get(iso);
      if (existing === undefined) {
        fullDrafts.set(iso, {
          patterns: [spec.pattern],
          day,
          month,
          year: resolution.year,
          iso,
          isPartial: false,
          score,
          era,
          yearNote: resolution.note,
        });
      } else {
        if (!existing.patterns.includes(spec.pattern)) existing.patterns.push(spec.pattern);
        if (score > existing.score) existing.score = score;
      }
    }
  }

  const partialDrafts: Draft[] = [];
  if (config.includePartials && digits.length >= 4) {
    const covered = new Set(
      [...fullDrafts.values()].map((draft) => formatPartialIso(draft.month, draft.day)),
    );
    const seen = new Map<string, Draft>();

    for (const spec of PARTIAL_SPECS) {
      const day = Number.parseInt(slice(digits, spec.day), 10);
      const month = Number.parseInt(slice(digits, spec.month), 10);
      // Validate against a leap year so that 29 February survives as a
      // recurring day/month with no year attached.
      if (!isValidCalendarDate(2000, month, day)) continue;

      const iso = formatPartialIso(month, day);
      if (covered.has(iso)) continue;

      const score = config.patternPriors[spec.pattern];
      const existing = seen.get(iso);
      if (existing === undefined) {
        const draft: Draft = {
          patterns: [spec.pattern],
          day,
          month,
          year: null,
          iso,
          isPartial: true,
          score,
          era: null,
          yearNote: null,
        };
        seen.set(iso, draft);
        partialDrafts.push(draft);
      } else {
        if (!existing.patterns.includes(spec.pattern)) existing.patterns.push(spec.pattern);
        if (score > existing.score) existing.score = score;
      }
    }
  }

  const fulls = [...fullDrafts.values()];

  // More than one distinct calendar date means the serial is genuinely
  // ambiguous; every reading loses some absolute certainty.
  if (fulls.length > 1) {
    for (const draft of fulls) draft.score *= config.ambiguityPenalty;
  }

  const drafts = [...fulls, ...partialDrafts];
  const total = drafts.reduce((sum, draft) => sum + draft.score, 0);

  const interpretations: DateInterpretation[] = drafts.map((draft) => {
    // Only *other* reading orders count as ambiguity. A pattern this reading
    // already uses can reach a second date through century resolution, but that
    // is explained by the year note — listing it here would read as "these
    // digits also mean something else under the order you just used".
    const ambiguousWith = draft.isPartial
      ? []
      : fulls
          .filter((other) => other.iso !== draft.iso)
          .flatMap((other) => other.patterns)
          .filter((pattern) => !draft.patterns.includes(pattern))
          .filter((pattern, index, list) => list.indexOf(pattern) === index);

    return {
      patterns: [...draft.patterns].sort(
        (a, b) => config.patternPriors[b] - config.patternPriors[a],
      ),
      day: draft.day,
      month: draft.month,
      year: draft.year,
      iso: draft.iso,
      isPartial: draft.isPartial,
      score: draft.score,
      confidence: total === 0 ? 0 : draft.score / total,
      era: draft.era,
      ambiguousWith,
      reasons: buildReasons(draft, config, ambiguousWith),
    };
  });

  return interpretations.sort((a, b) => {
    if (a.isPartial !== b.isPartial) return a.isPartial ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.iso.localeCompare(b.iso);
  });
}
