import type { DateOrderPattern } from '@rareminting/serial-engine';

/**
 * Maps a reading order onto slices of the digit block, so the UI can annotate
 * which digits are the day, the month and the year.
 */

export type SegmentKind = 'day' | 'month' | 'year';

export interface Segment {
  readonly start: number;
  readonly length: number;
  readonly kind: SegmentKind;
}

const SEGMENTS: Readonly<Record<DateOrderPattern, readonly Segment[]>> = {
  DDMMYY: [
    { start: 0, length: 2, kind: 'day' },
    { start: 2, length: 2, kind: 'month' },
    { start: 4, length: 2, kind: 'year' },
  ],
  MMDDYY: [
    { start: 0, length: 2, kind: 'month' },
    { start: 2, length: 2, kind: 'day' },
    { start: 4, length: 2, kind: 'year' },
  ],
  YYMMDD: [
    { start: 0, length: 2, kind: 'year' },
    { start: 2, length: 2, kind: 'month' },
    { start: 4, length: 2, kind: 'day' },
  ],
  DDMMYYYY: [
    { start: 0, length: 2, kind: 'day' },
    { start: 2, length: 2, kind: 'month' },
    { start: 4, length: 4, kind: 'year' },
  ],
  MMDDYYYY: [
    { start: 0, length: 2, kind: 'month' },
    { start: 2, length: 2, kind: 'day' },
    { start: 4, length: 4, kind: 'year' },
  ],
  YYYYMMDD: [
    { start: 0, length: 4, kind: 'year' },
    { start: 4, length: 2, kind: 'month' },
    { start: 6, length: 2, kind: 'day' },
  ],
  DDMM: [
    { start: 0, length: 2, kind: 'day' },
    { start: 2, length: 2, kind: 'month' },
  ],
  MMDD: [
    { start: 0, length: 2, kind: 'month' },
    { start: 2, length: 2, kind: 'day' },
  ],
};

export function segmentsFor(pattern: DateOrderPattern | undefined): readonly Segment[] {
  if (pattern === undefined) return [];
  return SEGMENTS[pattern] ?? [];
}

export function kindAt(index: number, segments: readonly Segment[]): SegmentKind | null {
  for (const segment of segments) {
    if (index >= segment.start && index < segment.start + segment.length) return segment.kind;
  }
  return null;
}

export const KIND_LABEL: Readonly<Record<SegmentKind, string>> = {
  day: 'day',
  month: 'month',
  year: 'year',
};
