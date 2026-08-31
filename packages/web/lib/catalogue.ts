import { analyzeSerial } from '@rareminting/serial-engine';
import type { PatternTag, SerialAnalysis } from '@rareminting/serial-engine';

/**
 * Seed inventory.
 *
 * Deterministic on purpose: a fixed-seed generator means the catalogue is
 * identical on every render and every machine, so screenshots and tests are
 * stable. Replaced by the listings table once the API exists.
 */

export type Grade = 'UNC' | 'AU' | 'XF' | 'VF' | 'F';

export interface SeedNote {
  readonly id: string;
  readonly serial: string;
  readonly denomination: number;
  readonly series: string;
  readonly grade: Grade;
  readonly seller: string;
  readonly priceInr: number;
}

export interface CatalogueEntry extends SeedNote {
  readonly analysis: SerialAnalysis;
}

/** Linear congruential generator — small, seeded and repeatable. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const DENOMINATIONS = [10, 20, 50, 100, 200, 500, 2000] as const;
const GRADES: readonly Grade[] = ['UNC', 'UNC', 'AU', 'XF', 'VF', 'F'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SELLERS = [
  'Kapoor Numismatics',
  'Deccan Currency House',
  'The Paper Vault',
  'Mint Street Collectibles',
  'Bengal Note Company',
  'Chandni Chowk Rarities',
];

const GRADE_MULTIPLIER: Readonly<Record<Grade, number>> = {
  UNC: 3.2,
  AU: 2.1,
  XF: 1.5,
  VF: 1.1,
  F: 0.85,
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function buildPrefix(rng: () => number): string {
  const numeral = Math.floor(rng() * 10);
  const a = LETTERS.charAt(Math.floor(rng() * LETTERS.length));
  const b = LETTERS.charAt(Math.floor(rng() * LETTERS.length));
  return `${numeral}${a}${b}`;
}

/**
 * Indicative price.
 *
 * A deliberately crude stand-in for the pricing engine: face value, scaled by
 * grade, rarity and how emotionally live the matched date is. Enough to make
 * the catalogue read realistically; not a valuation.
 */
function estimatePrice(
  denomination: number,
  grade: Grade,
  analysis: SerialAnalysis,
  rng: () => number,
): number {
  const base = Math.max(denomination, 50);
  const rarity = 1 + analysis.rarityScore * 14;
  const era = analysis.bestDate?.era;
  const sentiment = era === 'heritage' ? 2.4 : era === 'future' ? 1.9 : era === 'recent' ? 1.6 : era ? 1.35 : 1;
  const jitter = 0.85 + rng() * 0.4;
  const raw = base * GRADE_MULTIPLIER[grade] * rarity * sentiment * jitter;
  return Math.round(raw / 50) * 50;
}

/**
 * Serials guaranteeing the homepage's quick-pick dates always land on an exact
 * match. Keep in step with `SUGGESTED_DATES` in `lib/search.ts`.
 */
const MILESTONE_DIGITS: readonly string[] = [
  '150847', // 15 Aug 1947 — Independence Day
  '260150', // 26 Jan 1950 — Republic Day
  '150892', // 15 Aug 1992 — a birthday
  '250199', // 25 Jan 1999 — an anniversary
];

/** Serials chosen to exercise every branch of the taxonomy. */
const FANCY_DIGITS: readonly string[] = [
  '777777', '111111', '999999', '555555',
  '123321', '456654', '102201', '135531',
  '123456', '654321', '234567', '987654',
  '123123', '456456', '121212', '787878',
  '112233', '445566', '111222', '888999',
  '000001', '000007', '000042', '000100',
  '000786', '007861', '001008', '000108',
  '001947', '000420', '101101', '110011',
  '999990', '999998', '777775', '123322',
];

function buildSeed(): SeedNote[] {
  const rng = makeRng(20260831);
  const notes: SeedNote[] = [];
  let counter = 0;

  const push = (digits: string, star: boolean): void => {
    counter += 1;
    const denomination = DENOMINATIONS[Math.floor(rng() * DENOMINATIONS.length)] ?? 100;
    const grade = GRADES[Math.floor(rng() * GRADES.length)] ?? 'VF';
    const seller = SELLERS[Math.floor(rng() * SELLERS.length)] ?? SELLERS[0] ?? 'Rare Minting';
    const serial = `${buildPrefix(rng)}${star ? '*' : ''} ${digits}`;
    const analysis = analyzeSerial(serial);
    if (analysis === null) return;
    notes.push({
      id: `RM-${pad(counter, 4)}`,
      serial,
      denomination,
      series: denomination >= 200 ? 'Mahatma Gandhi New Series' : 'Mahatma Gandhi Series',
      grade,
      seller,
      priceInr: estimatePrice(denomination, grade, analysis, rng),
    });
  };

  // Date-shaped serials spread right across the calendar, so "Find My Date"
  // has broad day-and-month coverage to search against.
  for (let month = 1; month <= 12; month += 1) {
    for (let slot = 0; slot < 11; slot += 1) {
      const day = 1 + Math.floor(rng() * 28);
      const year = 1947 + Math.floor(rng() * 79);
      push(`${pad(day, 2)}${pad(month, 2)}${pad(year % 100, 2)}`, rng() < 0.08);
    }
  }

  for (const digits of MILESTONE_DIGITS) {
    push(digits, rng() < 0.35);
  }

  for (const digits of FANCY_DIGITS) {
    push(digits, rng() < 0.25);
  }

  while (notes.length < 200) {
    push(pad(Math.floor(rng() * 1_000_000), 6), rng() < 0.05);
  }

  return notes;
}

/**
 * The catalogue, analysed once at module load.
 *
 * Every note is run through the real serial engine — nothing here is
 * hand-written match data.
 */
export const CATALOGUE: readonly CatalogueEntry[] = buildSeed().map((note) => ({
  ...note,
  analysis: analyzeSerial(note.serial) as SerialAnalysis,
}));

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/** Distinct pattern codes present in the catalogue, with counts. */
export function tagCounts(): { code: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const entry of CATALOGUE) {
    for (const tag of entry.analysis.patterns) {
      const existing = counts.get(tag.code);
      if (existing === undefined) counts.set(tag.code, { label: tag.label, count: 1 });
      else existing.count += 1;
    }
  }
  return [...counts.entries()]
    .map(([code, value]) => ({ code, label: value.label, count: value.count }))
    .sort((a, b) => b.count - a.count);
}

export function topByRarity(limit: number): CatalogueEntry[] {
  return [...CATALOGUE]
    .sort((a, b) => b.analysis.rarityScore - a.analysis.rarityScore)
    .slice(0, limit);
}

export function strongestTag(tags: readonly PatternTag[]): PatternTag | null {
  return tags[0] ?? null;
}
