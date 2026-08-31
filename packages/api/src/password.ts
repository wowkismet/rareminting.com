/**
 * Password hashing.
 *
 * scrypt from `node:crypto`, not bcrypt or argon2. Both of those are native
 * addons that need a compiler at install time; scrypt is memory-hard, built in,
 * and has no build step — which matters for a deploy that must work on a bare
 * VPS. Parameters are stored in the hash string so they can be raised later
 * without invalidating existing passwords.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify picks the 3-argument overload, dropping the options form we need.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

// OWASP's floor for scrypt: N=2^17 with r=8, p=1. Kept at 2^15 so the test
// suite stays quick; raise for production via PASSWORD_SCRYPT_N.
const DEFAULT_COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function cost(): number {
  const configured = Number(process.env['PASSWORD_SCRYPT_N']);
  return Number.isInteger(configured) && configured >= 2 ** 14 ? configured : DEFAULT_COST;
}

function maxmem(n: number): number {
  // scrypt needs roughly 128 * N * r bytes; give it headroom or Node throws.
  return 256 * n * BLOCK_SIZE;
}

/** Hash a password into a self-describing string. Never reversible. */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) throw new Error('password must not be empty');
  const n = cost();
  const salt = randomBytes(SALT_LENGTH);
  const key = (await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, {
    N: n,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: maxmem(n),
  })) as Buffer;

  return [
    'scrypt',
    String(n),
    String(BLOCK_SIZE),
    String(PARALLELISM),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing for any malformed input: a corrupted row
 * must fail the login, not crash the endpoint.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 ** 12 || n > 2 ** 22) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64url');
    expected = Buffer.from(parts[5] ?? '', 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = (await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmem(n),
    })) as Buffer;
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Burn roughly the same time as a real verification.
 *
 * Called when the account does not exist, so that response timing does not
 * reveal which email addresses are registered.
 */
export async function fakeVerify(): Promise<void> {
  await verifyPassword('placeholder', await DUMMY_HASH);
}

const DUMMY_HASH: Promise<string> = hashPassword('not-a-real-password');
