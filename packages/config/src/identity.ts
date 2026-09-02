/**
 * Validators for the identity numbers a seller supplies at registration.
 *
 * Both PAN and Aadhaar are checkable offline: PAN by its rigid structure,
 * Aadhaar by a Verhoeff checksum. Catching a typo here means the seller sees
 * "check the 12th digit" while they still have the card in their hand, rather
 * than a rejection from a verification provider days later.
 *
 * Structural validity is not verification. A number that passes these checks
 * is well-formed, nothing more — it says nothing about whether the number is
 * issued, or issued to this person. Only UIDAI and the Income Tax Department
 * can answer that.
 */

/* ------------------------------ PAN ------------------------------ */

const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * The fourth character encodes what kind of holder the PAN belongs to.
 * A seller registering as an individual must present a 'P'.
 */
export const PAN_HOLDER_TYPES: Readonly<Record<string, string>> = {
  A: 'Association of persons',
  B: 'Body of individuals',
  C: 'Company',
  F: 'Firm or LLP',
  G: 'Government agency',
  H: 'Hindu undivided family',
  J: 'Artificial juridical person',
  L: 'Local authority',
  P: 'Individual',
  T: 'Trust',
};

export interface Pan {
  /** Upper-cased, whitespace removed. */
  readonly normalized: string;
  /** The fourth character. */
  readonly holderCode: string;
  readonly holderType: string;
  /** First letter of the surname (individuals) or entity name. */
  readonly nameInitial: string;
  readonly last4: string;
}

export function parsePan(input: string): Pan | null {
  const normalized = input.replace(/\s+/g, '').toUpperCase();
  if (!PAN_SHAPE.test(normalized)) return null;

  const holderCode = normalized.charAt(3);
  const holderType = PAN_HOLDER_TYPES[holderCode];
  if (holderType === undefined) return null;

  return {
    normalized,
    holderCode,
    holderType,
    nameInitial: normalized.charAt(4),
    last4: normalized.slice(-4),
  };
}

/**
 * Does the PAN's fifth character agree with the name given?
 *
 * For an individual the fifth character is the first letter of the *surname*,
 * which we cannot reliably pick out of a free-text name. So this checks the
 * weaker, defensible claim: the letter appears at the start of some part of
 * the name. It is a typo-catcher, not an identity check.
 */
export function panAgreesWithName(pan: Pan, fullName: string): boolean {
  const parts = fullName
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  return parts.some((part) => part.startsWith(pan.nameInitial));
}

/* ---------------------------- Aadhaar ---------------------------- */

/**
 * Verhoeff multiplication table (the dihedral group D5).
 *
 * Verhoeff catches every single-digit error and every adjacent transposition,
 * which is what people actually get wrong when copying twelve digits.
 */
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** Permutation table, applied cyclically by position. */
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True if a digit string carries a valid Verhoeff check digit. */
export function verhoeffValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    const row = D[c];
    const perm = P[i % 8];
    if (row === undefined || perm === undefined) return false;
    const mapped = perm[digit];
    if (mapped === undefined) return false;
    const next = row[mapped];
    if (next === undefined) return false;
    c = next;
  }
  return c === 0;
}

export interface Aadhaar {
  /** All twelve digits. Never log, display or persist this. */
  readonly normalized: string;
  /** Safe to show and to store: the form printed on receipts. */
  readonly masked: string;
  readonly last4: string;
}

/**
 * Parse a 12-digit Aadhaar number.
 *
 * Beyond the checksum, the first digit is never 0 or 1 — UIDAI reserves those
 * ranges — which rules out a whole class of made-up numbers.
 */
export function parseAadhaar(input: string): Aadhaar | null {
  const normalized = input.replace(/[\s-]+/g, '');
  if (!/^[2-9][0-9]{11}$/.test(normalized)) return null;
  if (!verhoeffValid(normalized)) return null;

  const last4 = normalized.slice(-4);
  return { normalized, masked: `XXXX XXXX ${last4}`, last4 };
}

/**
 * Mask anything that looks like an Aadhaar number in free text.
 *
 * A backstop for places a number should never have reached — a description
 * field, a support message — so it does not end up rendered on a public page.
 */
export function maskAadhaarIn(text: string): string {
  return text.replace(/\b[2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/g, (match) => {
    const digits = match.replace(/[\s-]/g, '');
    return verhoeffValid(digits) ? `XXXX XXXX ${digits.slice(-4)}` : match;
  });
}

/* ---------------------------- Mobile ----------------------------- */

/**
 * Indian mobile numbers in E.164.
 *
 * Accepts the forms people actually type — with or without +91, with spaces or
 * a leading 0 — and normalises to +91XXXXXXXXXX. Indian mobile numbers begin
 * with 6, 7, 8 or 9; anything else is a landline or a typo.
 */
export function parseIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s()-]+/g, '').replace(/^\+/, '');
  const local = digits.startsWith('91') && digits.length === 12
    ? digits.slice(2)
    : digits.startsWith('0') && digits.length === 11
      ? digits.slice(1)
      : digits;
  if (!/^[6-9][0-9]{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** +919812345678 -> +91 98xxxxxx78. For support screens and audit trails. */
export function maskMobile(e164: string): string {
  const local = e164.replace(/^\+91/, '');
  if (local.length !== 10) return e164;
  return `+91 ${local.slice(0, 2)}xxxxxx${local.slice(-2)}`;
}
