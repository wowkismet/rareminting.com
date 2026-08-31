/**
 * Digit-block primitives.
 *
 * Everything here operates on a string of ASCII digits with leading zeros
 * intact. No function in this module converts a serial to a number except where
 * the caller explicitly asks for its numeric value.
 */

const ZERO = 48;

/** True when `value` is a non-empty string of ASCII digits only. */
export function isAllDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < ZERO || code > ZERO + 9) return false;
  }
  return true;
}

/** Convert a digit block to numeric digits. Throws on any non-digit character. */
export function toDigitArray(digits: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 1) {
    const code = digits.charCodeAt(i);
    if (code < ZERO || code > ZERO + 9) {
      throw new TypeError(`Not a digit block: ${JSON.stringify(digits)}`);
    }
    out.push(code - ZERO);
  }
  return out;
}

/**
 * Bounds-checked index access.
 *
 * `noUncheckedIndexedAccess` is on, and silently coercing an out-of-range digit
 * to `0` would corrupt a serial. Fail loudly instead.
 */
export function digitAt(digits: readonly number[], index: number): number {
  const value = digits[index];
  if (value === undefined) {
    throw new RangeError(`Digit index ${index} out of range (length ${digits.length})`);
  }
  return value;
}

export function reverse(value: string): string {
  let out = '';
  for (let i = value.length - 1; i >= 0; i -= 1) out += value.charAt(i);
  return out;
}

export interface DigitRun {
  readonly digit: string;
  readonly length: number;
}

/** Consecutive equal digits, in order. `112233` → three runs of length 2. */
export function runLengths(digits: string): DigitRun[] {
  const runs: DigitRun[] = [];
  let current = '';
  let count = 0;
  for (const char of digits) {
    if (char === current) {
      count += 1;
    } else {
      if (count > 0) runs.push({ digit: current, length: count });
      current = char;
      count = 1;
    }
  }
  if (count > 0) runs.push({ digit: current, length: count });
  return runs;
}

export function distinctDigits(digits: string): Set<string> {
  return new Set(digits);
}

/** How many times the most common digit appears. */
export function maxDigitFrequency(digits: string): number {
  const counts = new Map<string, number>();
  let best = 0;
  for (const char of digits) {
    const next = (counts.get(char) ?? 0) + 1;
    counts.set(char, next);
    if (next > best) best = next;
  }
  return best;
}

/** Repeated digit sum until a single digit remains. `150892` → 25 → 7. */
export function digitalRoot(digits: string): number {
  let sum = 0;
  for (const value of toDigitArray(digits)) sum += value;
  while (sum >= 10) {
    let next = 0;
    let rest = sum;
    while (rest > 0) {
      next += rest % 10;
      rest = Math.floor(rest / 10);
    }
    sum = next;
  }
  return sum;
}

/** Positive divisors of `n` strictly between 1 and `n`. Used for repeater blocks. */
export function properDivisors(n: number): number[] {
  const out: number[] = [];
  for (let d = 2; d < n; d += 1) {
    if (n % d === 0) out.push(d);
  }
  return out;
}

/** Number of positions at which two equal-length strings differ. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new RangeError(`Hamming distance needs equal lengths: ${a.length} vs ${b.length}`);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a.charAt(i) !== b.charAt(i)) distance += 1;
  }
  return distance;
}

/** Left-pad with zeros to `width`. Never truncates. */
export function padDigits(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
