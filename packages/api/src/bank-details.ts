/**
 * Bank account numbers.
 *
 * Paying sellers by transfer means we have to hold the actual account number,
 * which a gateway split would have spared us. So it is encrypted rather than
 * stored in the clear: a dump of the database alone hands over nothing, because
 * the key lives in the environment.
 *
 * Encryption, not hashing, because unlike a PAN this has to be read back — an
 * admin cannot make a transfer to a fingerprint.
 *
 * AES-256-GCM is authenticated: tampering with the ciphertext makes decryption
 * fail rather than silently returning a different account number, which is the
 * property that matters when the output is where money goes.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

function key(): Buffer {
  const secret = process.env['BANK_DETAILS_KEY'];
  if (secret === undefined || secret.length < 32) {
    throw new Error(
      'BANK_DETAILS_KEY is missing or too short (needs at least 32 characters). ' +
        'Bank details cannot be stored safely without it.',
    );
  }
  // A fixed salt: the key must derive identically on every process start, or
  // yesterday's ciphertext stops decrypting. The secret itself carries the
  // entropy — this is stretching, not salting a password.
  return scryptSync(secret, 'rareminting.bank.v1', KEY_BYTES);
}

export function bankStorageConfigured(): boolean {
  const secret = process.env['BANK_DETAILS_KEY'];
  return secret !== undefined && secret.length >= 32;
}

/** Encrypt an account number. Returns "iv:tag:ciphertext", each base64. */
export function encryptAccountNumber(accountNumber: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(accountNumber, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/**
 * Decrypt an account number.
 *
 * Throws if the ciphertext was altered — GCM's tag check fails rather than
 * returning plausible-looking rubbish. Callers should let that propagate: a
 * corrupted account number must stop a transfer, not redirect it.
 */
export function decryptAccountNumber(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Stored bank detail is malformed.');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Indian bank account numbers: 9 to 18 digits, no separators. */
export function parseAccountNumber(input: string): string | null {
  const digits = input.replace(/[\s-]+/g, '');
  return /^[0-9]{9,18}$/.test(digits) ? digits : null;
}

/** IFSC: four letters, a zero, then six alphanumerics. */
export function parseIfsc(input: string): string | null {
  const normalized = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized) ? normalized : null;
}

/** What is safe to show back: the last four digits only. */
export function accountLast4(accountNumber: string): string {
  return accountNumber.slice(-4);
}

export function maskAccount(last4: string): string {
  return `••••••${last4}`;
}
