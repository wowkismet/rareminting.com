/**
 * The brand, in one place.
 *
 * These are the same values the website uses in `packages/web/app/globals.css`.
 * They are duplicated rather than imported because a React Native bundle
 * cannot read a CSS file — but they must not drift, so if one changes here it
 * changes there, and the hexes are written out in full rather than derived so
 * a mismatch is visible in a diff.
 */

export const colour = {
  /** Deep forest green — the ground everything dark sits on. */
  primary: '#1a4a2e',
  /** Deep teal — the second surface, for rails and bars. */
  secondary: '#1a4a46',
  /** Antique gold — the accent, used sparingly. */
  accent: '#c9a84c',

  /** Deepest ground, the primary pushed down. */
  ink: '#0a1f14',
  /** Hairlines on green. */
  line: '#2d6045',
  /** Body text on green. */
  cream: '#f3ede1',
  /** 5.3:1 on primary — secondary text on green. */
  creamDim: '#a9c0b0',
  /** 6.2:1 on primary — small gold labels that must stay legible. */
  accentBright: '#e3c887',

  /** Page surface. */
  sand: '#ede4d3',
  /** Cards sitting on sand. */
  sandRaised: '#f7f2e8',
  /** Hairlines on sand. */
  sandLine: '#d9cdb6',
  /** Headings and body text on sand. */
  slate: '#0d2418',
  /** 4.8:1 on sand. */
  slateDim: '#55665c',
  /** 4.7:1 on sand — gold that survives on cream. */
  accentDeep: '#7a6224',

  /** Warnings, and the star on a replacement note. */
  ember: '#cf7250',
} as const;

/**
 * A four-point scale.
 *
 * Everything is a multiple of 4, so nothing lands on a half pixel at 1.5x or
 * 2.5x density, which is where hairline borders disappear on Android.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  /** The house corner: barely rounded, like a printed note's edge. */
  sm: 3,
  md: 6,
  /** Buttons and chips. */
  pill: 999,
} as const;

export const type = {
  /** Serial numbers, prices, anything read digit by digit. */
  mono: 'monospace' as const,
  size: {
    micro: 10,
    small: 12,
    body: 14,
    lead: 16,
    title: 20,
    display: 28,
    hero: 34,
  },
  /**
   * Capitals in an eyebrow need this or they close up. The value is in points
   * rather than an em multiple because React Native's letterSpacing is
   * absolute.
   */
  tracking: {
    eyebrow: 2.4,
    serial: 1.4,
  },
} as const;

/** Money, the way it is written in India. */
export function rupees(inr: number): string {
  return `₹${inr.toLocaleString('en-IN')}`;
}

/**
 * A date the way a serial spells it.
 *
 * The same rule the website follows: 190609 reads as 19-06-2009, and showing
 * that as 2009-06-19 makes the digits look rearranged on the one screen
 * explaining that they are not.
 */
export function dayFirst(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m === null ? iso : `${m[3]}-${m[2]}-${m[1]}`;
}
