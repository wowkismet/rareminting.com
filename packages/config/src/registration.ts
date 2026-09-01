/**
 * Validators for Indian company registration identifiers.
 *
 * These exist so a mistyped GSTIN or CIN fails a test rather than appearing on
 * an invoice. A GSTIN carries a mod-36 checksum, so a single transposed
 * character is detectable; a CIN has no checksum but a rigid structure whose
 * parts can be cross-checked against each other.
 */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GST state codes referenced by this project. Extend as needed. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  '07': 'Delhi',
  '19': 'West Bengal',
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
};

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * The 15th character of a GSTIN, computed from the first 14.
 *
 * Weights alternate 1,2 across the string; each product is folded by dividing
 * by 36 and adding the remainder, and the check character is whatever brings
 * the total up to a multiple of 36.
 */
export function gstinCheckDigit(gstin: string): string | null {
  if (gstin.length < 14) return null;
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = CHARSET.indexOf(gstin.charAt(i));
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET.charAt((36 - (total % 36)) % 36);
}

export interface GstinParts {
  readonly stateCode: string;
  readonly stateName: string | null;
  readonly pan: string;
  /** 'C' for a company, 'P' for an individual, and so on. */
  readonly entityType: string;
  readonly isCompany: boolean;
}

export type GstinResult =
  | { readonly ok: true; readonly parts: GstinParts }
  | { readonly ok: false; readonly reason: string };

export function parseGstin(gstin: string): GstinResult {
  if (gstin.length !== 15) {
    return { ok: false, reason: `A GSTIN is 15 characters; this is ${gstin.length}.` };
  }
  if (!GSTIN_SHAPE.test(gstin)) {
    return { ok: false, reason: 'Does not match the GSTIN structure.' };
  }
  const expected = gstinCheckDigit(gstin);
  if (expected === null || expected !== gstin.charAt(14)) {
    return {
      ok: false,
      reason: `Checksum is wrong: expected ${expected ?? '?'}, found ${gstin.charAt(14)}. Likely a typo.`,
    };
  }

  const stateCode = gstin.slice(0, 2);
  const entityType = gstin.charAt(5);
  return {
    ok: true,
    parts: {
      stateCode,
      stateName: GST_STATE_CODES[stateCode] ?? null,
      pan: gstin.slice(2, 12),
      entityType,
      isCompany: entityType === 'C',
    },
  };
}

const CIN_SHAPE = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/;

/** Company classes this project expects to encounter. */
export const CIN_CLASSES: Readonly<Record<string, string>> = {
  PTC: 'Private Limited Company',
  PLC: 'Public Limited Company',
  OPC: 'One Person Company',
  FTC: 'Subsidiary of a Foreign Company',
  GOI: 'Government of India company',
  SGC: 'State Government company',
  NPL: 'Not-for-profit (Section 8)',
};

export interface CinParts {
  readonly isListed: boolean;
  readonly industryCode: string;
  readonly stateCode: string;
  readonly incorporatedYear: number;
  readonly classCode: string;
  readonly className: string | null;
  readonly registrationNumber: string;
}

export type CinResult =
  | { readonly ok: true; readonly parts: CinParts }
  | { readonly ok: false; readonly reason: string };

export function parseCin(cin: string): CinResult {
  if (cin.length !== 21) {
    return { ok: false, reason: `A CIN is 21 characters; this is ${cin.length}.` };
  }
  const match = CIN_SHAPE.exec(cin);
  if (match === null) {
    return { ok: false, reason: 'Does not match the CIN structure.' };
  }

  const year = Number(match[4]);
  const currentYear = new Date().getUTCFullYear();
  if (year < 1850 || year > currentYear) {
    return { ok: false, reason: `Incorporation year ${year} is not plausible.` };
  }

  const classCode = match[5] ?? '';
  return {
    ok: true,
    parts: {
      isListed: match[1] === 'L',
      industryCode: match[2] ?? '',
      stateCode: match[3] ?? '',
      incorporatedYear: year,
      classCode,
      className: CIN_CLASSES[classCode] ?? null,
      registrationNumber: match[6] ?? '',
    },
  };
}

/** GST state code to the two-letter state used in a CIN. */
const GST_TO_CIN_STATE: Readonly<Record<string, string>> = {
  '07': 'DL',
  '19': 'WB',
  '24': 'GJ',
  '27': 'MH',
  '29': 'KA',
  '33': 'TN',
  '36': 'TG',
};

/** True when a GSTIN and a CIN agree about which state the entity sits in. */
export function statesAgree(gstin: string, cin: string): boolean {
  const expected = GST_TO_CIN_STATE[gstin.slice(0, 2)];
  return expected !== undefined && expected === cin.slice(6, 8);
}
