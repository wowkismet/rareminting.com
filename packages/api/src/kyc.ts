/**
 * Storage of identity numbers.
 *
 * The rule this file exists to enforce: a PAN or Aadhaar number is never
 * written to the database, never logged, and never returned by any endpoint.
 * What we keep is an HMAC — enough to recognise the same number arriving
 * twice — and the last four characters, which is what a support conversation
 * needs to confirm which card a seller is holding.
 *
 * The HMAC is keyed rather than bare because an Aadhaar number has only 10^12
 * possible values. An unkeyed SHA-256 of one is recoverable by exhaustive
 * search on a laptop, so a bare digest would be the number itself in a thin
 * disguise. The key lives outside the database; a dump of the table alone
 * yields nothing.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Read the pepper, or refuse to run.
 *
 * Falling back to a default or an empty key would silently downgrade every
 * stored hash to a brute-forceable digest, and nothing would look wrong. A
 * missing key is a deployment error and is treated as one.
 */
function pepper(): string {
  const value = process.env['KYC_NUMBER_PEPPER'];
  if (value === undefined || value.length < 32) {
    throw new Error(
      'KYC_NUMBER_PEPPER is missing or too short (needs at least 32 characters). ' +
        'Identity numbers cannot be stored safely without it.',
    );
  }
  return value;
}

/** HMAC-SHA256 of a normalised identity number, hex encoded. */
export function hashIdentityNumber(normalized: string): string {
  return createHmac('sha256', pepper()).update(normalized, 'utf8').digest('hex');
}

/** Compare two hashes without leaking their contents through timing. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** True when the service is configured to store identity numbers at all. */
export function kycStorageConfigured(): boolean {
  const value = process.env['KYC_NUMBER_PEPPER'];
  return value !== undefined && value.length >= 32;
}
