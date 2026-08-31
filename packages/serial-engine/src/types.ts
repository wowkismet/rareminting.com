/**
 * Canonical domain types for the Rare Minting serial-number engine.
 *
 * Every field that the marketplace filters, facets or prices on is modelled as a
 * discrete field. Serial numbers are never stored as a single opaque blob — the
 * prefix, the star marker and the digit block are independently searchable.
 *
 * Digit blocks are always carried as `string`, never `number`, so that leading
 * zeros survive. `000001` and `1` are entirely different notes.
 */

/* -------------------------------------------------------------------------- */
/* Serial parsing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Known serial layouts.
 *
 * - `IN_MG_NEW`  Mahatma Gandhi / MG New Series: 1 numeral + 2 letters, then 6 digits (`9AB 150892`).
 * - `IN_LEGACY`  Older Indian fractional prefixes (`A/1 123456`).
 * - `GENERIC`    World and pre-decimal notes: variable-length alphanumeric prefix, 1–12 digits.
 */
export type SerialFormat = 'IN_MG_NEW' | 'IN_LEGACY' | 'GENERIC';

export interface ParsedSerial {
  /** Exactly what the seller or OCR pipeline submitted. */
  readonly raw: string;
  /** Canonical display form, e.g. `9AB* 150892`. */
  readonly normalized: string;
  readonly format: SerialFormat;
  /** Small inset letter in the number panel; `null` when the note is plain-inset. */
  readonly insetLetter: string | null;
  /** Full prefix as printed, e.g. `9AB`. `null` for bare-digit serials. */
  readonly prefix: string | null;
  /** Leading numeral of an Indian prefix, e.g. `9`. */
  readonly prefixNumeral: string | null;
  /** Letter portion of an Indian prefix, e.g. `AB`. */
  readonly prefixLetters: string | null;
  /** Star-series replacement note. Always a premium. */
  readonly isStar: boolean;
  /** Digit block with leading zeros preserved, e.g. `015089`. */
  readonly serialDigits: string;
  /** Numeric value of the digit block. Use only for range maths, never for display. */
  readonly serialValue: number;
  readonly digitCount: number;
}

export type ParseErrorCode =
  | 'EMPTY_INPUT'
  | 'UNRECOGNIZED_FORMAT'
  | 'NO_DIGITS'
  | 'DIGIT_COUNT_OUT_OF_RANGE';

export interface ParseError {
  readonly code: ParseErrorCode;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly serial: ParsedSerial; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly ParseError[]; readonly warnings: readonly string[] };

export interface ParseOptions {
  /**
   * Repair the classic OCR confusions (O→0, I→1, S→5, B→8) inside the digit
   * block. Off by default: silent repair of a human-entered serial would be a
   * data-integrity bug. The OCR service turns it on and surfaces the warnings.
   */
  readonly repairOcrConfusions?: boolean;
  /** Minimum digits accepted in `GENERIC` mode. */
  readonly minDigits?: number;
  /** Maximum digits accepted in `GENERIC` mode. */
  readonly maxDigits?: number;
}

/* -------------------------------------------------------------------------- */
/* Date interpretation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Orderings a digit block can be read in.
 *
 * `DDMM` / `MMDD` are *partial* reads — day and month are known, the year is
 * not. They power "near match" results and matched-pair suggestions.
 */
export type DateOrderPattern =
  | 'DDMMYY'
  | 'MMDDYY'
  | 'YYMMDD'
  | 'DDMMYYYY'
  | 'MMDDYYYY'
  | 'YYYYMMDD'
  | 'DDMM'
  | 'MMDD';

/**
 * How old the matched date is, relative to "now". Drives both editorial framing
 * and the sentiment multiplier in the pricing engine.
 */
export type DateEra = 'heritage' | 'historic' | 'modern' | 'recent' | 'future';

export interface DateInterpretation {
  /** Every ordering that produces this same calendar date. */
  readonly patterns: readonly DateOrderPattern[];
  readonly day: number;
  readonly month: number;
  /** `null` for partial (`DDMM` / `MMDD`) reads. */
  readonly year: number | null;
  /** ISO `YYYY-MM-DD`, or `--MM-DD` for partial reads. */
  readonly iso: string;
  readonly isPartial: boolean;
  /** Absolute plausibility, 0–1. Comparable across different serials. */
  readonly score: number;
  /** Share of this serial's total plausibility, 0–1. Sums to 1 across the list. */
  readonly confidence: number;
  /** `null` for partial reads, which have no year and therefore no era. */
  readonly era: DateEra | null;
  /** Orderings that yield a *different* valid date from the same digits. */
  readonly ambiguousWith: readonly DateOrderPattern[];
  /** Plain-language drivers, surfaced in the UI and the certificate. */
  readonly reasons: readonly string[];
}

export interface DateEngineConfig {
  /** Relative likelihood of each reading order. Indian convention leads. */
  readonly patternPriors: Readonly<Record<DateOrderPattern, number>>;
  /** Earliest year a two-digit year may resolve to. */
  readonly minYear: number;
  /** Earliest year an explicit four-digit year may express. Heritage notes need headroom. */
  readonly minExplicitYear: number;
  /** How far past "now" a date may resolve — covers newborns and booked weddings. */
  readonly futureYears: number;
  /** Multiplier applied to the less-recent century when both are plausible. */
  readonly olderCenturyPenalty: number;
  /** Multiplier applied to every reading when the digits admit more than one date. */
  readonly ambiguityPenalty: number;
  readonly eraWeights: Readonly<Record<DateEra, number>>;
  /** Emit `DDMM` / `MMDD` partial reads alongside full dates. */
  readonly includePartials: boolean;
}

/**
 * Tuning overrides for the date engine.
 *
 * Deliberately *deeply* partial: `Partial<DateEngineConfig>` would still demand
 * a complete `patternPriors` record, so an operator could not nudge a single
 * prior without restating all eight. Admin tuning has to be per-key.
 */
export interface DateEngineConfigOverrides
  extends Partial<Omit<DateEngineConfig, 'patternPriors' | 'eraWeights'>> {
  readonly patternPriors?: Partial<Record<DateOrderPattern, number>>;
  readonly eraWeights?: Partial<Record<DateEra, number>>;
}

export interface DateEngineOptions {
  /** Injected clock. Always pass this in tests — era depends on it. */
  readonly now?: Date;
  readonly config?: DateEngineConfigOverrides;
}

/* -------------------------------------------------------------------------- */
/* Fancy-pattern taxonomy                                                     */
/* -------------------------------------------------------------------------- */

export type PatternCode =
  | 'SOLID'
  | 'RADAR'
  | 'LADDER_ASC'
  | 'LADDER_DESC'
  | 'LADDER_ASC_WRAP'
  | 'LADDER_DESC_WRAP'
  | 'REPEATER'
  | 'DOUBLE_PAIRS'
  | 'TRIPLE_PAIRS'
  | 'LOW_SERIAL'
  | 'HIGH_SERIAL'
  | 'BINARY'
  | 'LUCKY'
  | 'NOVELTY'
  | 'SEMI_FANCY'
  | 'STAR_SERIES'
  /** Not derivable from the serial — supplied by image analysis or manual review. */
  | 'ERROR_NOTE';

export interface PatternTag {
  readonly code: PatternCode;
  readonly label: string;
  /** Rarity weight 0–1. Feeds the pricing engine's rarity score. */
  readonly weight: number;
  /** Human-readable specifics, e.g. `block of 3 repeated twice`. */
  readonly detail: string | null;
  /** 1 = strongest band. `null` where the pattern has no bands. */
  readonly tier: number | null;
}

export interface LuckyToken {
  readonly token: string;
  readonly label: string;
  /** Weight when the whole digit block equals the token. Scaled down for weaker matches. */
  readonly weight: number;
}

export interface LowSerialBand {
  /** Inclusive upper bound of the band. */
  readonly max: number;
  readonly tier: number;
  readonly weight: number;
}

export interface PatternEngineConfig {
  readonly luckyTokens: readonly LuckyToken[];
  readonly noveltyTokens: readonly LuckyToken[];
  readonly lowSerialBands: readonly LowSerialBand[];
  /** Multiplier when a token matches at the end of the block rather than the whole of it. */
  readonly suffixMatchFactor: number;
  /** Multiplier when a token merely appears somewhere inside the block. */
  readonly containsMatchFactor: number;
  /** Base weights for each structural pattern. */
  readonly weights: Readonly<Record<PatternCode, number>>;
}

/** Per-key tuning overrides for the pattern engine. See `DateEngineConfigOverrides`. */
export interface PatternEngineConfigOverrides
  extends Partial<Omit<PatternEngineConfig, 'weights'>> {
  readonly weights?: Partial<Record<PatternCode, number>>;
}

export interface PatternEngineOptions {
  readonly config?: PatternEngineConfigOverrides;
}

/* -------------------------------------------------------------------------- */
/* Matched pairs                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A full `DDMMYYYY` date cannot fit on one 6-digit note, so the platform sells
 * it as a two-note lot: one note carrying the day+month, one carrying the year.
 */
export interface PairPlan {
  readonly iso: string;
  /** Digits the day-and-month note must end with, e.g. `1508`. */
  readonly dayMonthFragment: string;
  /** US-ordered alternative, e.g. `0815`. */
  readonly monthDayFragment: string;
  /** Digits the year note must end with, e.g. `1947`. */
  readonly yearFragment: string;
  readonly description: string;
}

/* -------------------------------------------------------------------------- */
/* Top-level analysis                                                         */
/* -------------------------------------------------------------------------- */

export interface SerialAnalysis {
  readonly serial: ParsedSerial;
  readonly warnings: readonly string[];
  /** Ranked most-plausible first. */
  readonly dates: readonly DateInterpretation[];
  readonly bestDate: DateInterpretation | null;
  readonly patterns: readonly PatternTag[];
  /** Aggregate 0–1 rarity, dominated by the strongest tag. */
  readonly rarityScore: number;
}

/**
 * Options for the combined analysis.
 *
 * The two engine configs are named separately rather than inherited, because
 * `DateEngineOptions` and `PatternEngineOptions` each define their own `config`
 * and a single merged `config` key could only ever mean one of them.
 */
export interface AnalyzeOptions extends ParseOptions {
  /** Injected clock. Always pass this in tests — date era depends on it. */
  readonly now?: Date;
  readonly dateConfig?: DateEngineConfigOverrides;
  readonly patternConfig?: PatternEngineConfigOverrides;
}
