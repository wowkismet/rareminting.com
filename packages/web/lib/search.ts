import type { DateInterpretation } from '@rareminting/serial-engine';
import { CATALOGUE, type CatalogueEntry } from './catalogue.ts';

/**
 * Find My Date.
 *
 * Three tiers, in the order a buyer cares about them:
 *   exact     — a reading of the serial lands on the buyer's exact date
 *   dayMonth  — same day and month, a different year (the classic near miss)
 *   none      — nothing in stock, which is the cue to offer a saved alert
 */

export type MatchKind = 'exact' | 'day-month';

export interface Match {
  readonly entry: CatalogueEntry;
  readonly interpretation: DateInterpretation;
  readonly kind: MatchKind;
}

export interface SearchResult {
  readonly iso: string;
  readonly exact: readonly Match[];
  readonly dayMonth: readonly Match[];
}

/** Parse a `YYYY-MM-DD` string from the query without timezone drift. */
export function parseIsoDate(value: string | undefined): {
  year: number;
  month: number;
  day: number;
  iso: string;
} | null {
  if (value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
}

export function search(iso: string): SearchResult {
  const target = parseIsoDate(iso);
  if (target === null) return { iso, exact: [], dayMonth: [] };

  const exact: Match[] = [];
  const dayMonth: Match[] = [];

  for (const entry of CATALOGUE) {
    let best: Match | null = null;

    for (const interpretation of entry.analysis.dates) {
      const sameDayMonth =
        interpretation.day === target.day && interpretation.month === target.month;
      if (!sameDayMonth) continue;

      const isExact = interpretation.year === target.year;
      const kind: MatchKind = isExact ? 'exact' : 'day-month';

      // Prefer an exact hit, then the most confident reading.
      if (
        best === null ||
        (kind === 'exact' && best.kind !== 'exact') ||
        (kind === best.kind && interpretation.confidence > best.interpretation.confidence)
      ) {
        best = { entry, interpretation, kind };
      }
    }

    if (best === null) continue;
    if (best.kind === 'exact') exact.push(best);
    else dayMonth.push(best);
  }

  const byConfidence = (a: Match, b: Match): number =>
    b.interpretation.confidence - a.interpretation.confidence ||
    b.entry.analysis.rarityScore - a.entry.analysis.rarityScore;

  return {
    iso,
    exact: exact.sort(byConfidence),
    dayMonth: dayMonth.sort(byConfidence),
  };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function formatLongDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (parsed === null) return iso;
  return `${parsed.day} ${MONTHS[parsed.month - 1] ?? ''} ${parsed.year}`;
}

/**
 * A date the way it is written in India, and the way the serial spells it.
 *
 * This matters more here than as a regional preference. A serial of 190609
 * reads as 19-06-2009; shown in ISO as 2009-06-19 the digits appear
 * rearranged, and the whole premise of the site — that the number on the note
 * *is* the date — stops being visible on the one page where it is being
 * explained.
 *
 * Zero-padded so a column of them lines up, and so 09-06 is never mistaken
 * for 9 June read the other way round.
 */
export function formatDayFirst(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (parsed === null) return iso;
  const dd = String(parsed.day).padStart(2, '0');
  const mm = String(parsed.month).padStart(2, '0');
  return `${dd}-${mm}-${parsed.year}`;
}

/** A day and month with no year behind them, as DD-MM. */
export function formatDayMonth(day: number, month: number): string {
  return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
}

/** Dates with something worth showing, used for the quick-pick chips. */
export const SUGGESTED_DATES: readonly { iso: string; label: string }[] = [
  { iso: '1947-08-15', label: 'Independence Day' },
  { iso: '1950-01-26', label: 'Republic Day' },
  { iso: '1992-08-15', label: 'A birthday' },
  { iso: '1999-01-25', label: 'An anniversary' },
];
