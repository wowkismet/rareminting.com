/**
 * One-time passcodes.
 *
 * Codes are stored hashed, so a leaked table does not grant account access.
 * They expire, they are single-use, and both the number of attempts against a
 * challenge and the number of challenges per recipient are capped — a six-digit
 * code is only worth anything if you cannot try a million of them.
 *
 * Delivery is deliberately a separate concern. Without a configured provider
 * this module reports that OTP is unavailable; it never pretends a code was
 * sent, and never accepts one that was not.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import type { Db } from './db.ts';
import { one } from './db.ts';

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
/** Challenges per recipient per hour, across all purposes. */
export const OTP_MAX_PER_HOUR = 5;

export type OtpPurpose = 'seller_mobile' | 'login' | 'email_verify';

/** Codes are hashed with the same pepper that protects identity numbers. */
function hashCode(code: string, target: string, purpose: string): string {
  const key = process.env['KYC_NUMBER_PEPPER'] ?? '';
  if (key.length < 32) {
    throw new Error('KYC_NUMBER_PEPPER is missing or too short; OTP codes cannot be hashed.');
  }
  // The target and purpose are bound into the hash so a code minted for one
  // number and purpose cannot be replayed against another.
  return createHmac('sha256', key).update(`${purpose}:${target}:${code}`, 'utf8').digest('hex');
}

/** A six-digit code from a cryptographic source, leading zeros preserved. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface Sender {
  readonly name: string;
  send(target: string, code: string): Promise<void>;
}

/**
 * Pick a delivery channel from the environment.
 *
 * Returns null when nothing is configured, which callers must treat as "OTP is
 * unavailable" rather than "OTP passed".
 */
export function resolveSender(): Sender | null {
  const provider = process.env['SMS_PROVIDER'];
  if (provider === undefined || provider === '' || provider === 'none') return null;

  if (provider === 'console') {
    // Development only. Guarded so it cannot be switched on in production by a
    // stray environment variable.
    if (process.env['NODE_ENV'] === 'production') return null;
    return {
      name: 'console',
      send(target, code) {
        console.log(`[otp] ${target} -> ${code}`);
        return Promise.resolve();
      },
    };
  }

  return null;
}

export function otpAvailable(): boolean {
  return resolveSender() !== null;
}

export interface ChallengeRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

export type IssueResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: 'unavailable' | 'rate_limited' };

/**
 * Create and send a challenge for a mobile number.
 *
 * The code is returned to nobody: it goes to the sender and to the hash, and
 * exists nowhere else.
 */
export async function issueMobileOtp(
  db: Db,
  phoneE164: string,
  purpose: OtpPurpose,
): Promise<IssueResult> {
  const sender = resolveSender();
  if (sender === null) return { ok: false, reason: 'unavailable' };

  const recent = await db.query<{ count: string }>(
    `select count(*)::text as count from otp_challenges
      where phone_e164 = $1 and created_at > now() - interval '1 hour'`,
    [phoneE164],
  );
  const used = Number(recent.rows[0]?.count ?? '0');
  if (used >= OTP_MAX_PER_HOUR) return { ok: false, reason: 'rate_limited' };

  const code = generateCode();
  const inserted = await db.query<{ id: string }>(
    `insert into otp_challenges (phone_e164, code_hash, purpose, max_attempts, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(secs => $5))
     returning id`,
    [phoneE164, hashCode(code, phoneE164, purpose), purpose, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('failed to create otp challenge');

  await sender.send(phoneE164, code);
  return { ok: true, id: row.id };
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' | 'expired' | 'used' | 'exhausted' | 'wrong' };

/**
 * Check a code against the most recent live challenge for this number.
 *
 * A wrong code costs an attempt whether or not the challenge exists, and every
 * failure reads the same from outside, so this cannot be used to discover
 * which numbers have a challenge open.
 */
export async function verifyMobileOtp(
  db: Db,
  phoneE164: string,
  purpose: OtpPurpose,
  code: string,
): Promise<VerifyResult> {
  const found = await db.query<ChallengeRow>(
    `select id, code_hash, attempts, max_attempts, expires_at, consumed_at
       from otp_challenges
      where phone_e164 = $1 and purpose = $2
      order by created_at desc
      limit 1`,
    [phoneE164, purpose],
  );
  const challenge = one(found);
  if (challenge === null) return { ok: false, reason: 'not_found' };
  if (challenge.consumed_at !== null) return { ok: false, reason: 'used' };
  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (challenge.attempts >= challenge.max_attempts) return { ok: false, reason: 'exhausted' };

  const expected = challenge.code_hash;
  const actual = hashCode(code, phoneE164, purpose);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');
  const matches = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);

  if (!matches) {
    await db.query(`update otp_challenges set attempts = attempts + 1 where id = $1`, [
      challenge.id,
    ]);
    return { ok: false, reason: 'wrong' };
  }

  // Consume atomically: two requests racing with the same correct code must
  // not both succeed.
  const consumed = await db.query<{ id: string }>(
    `update otp_challenges set consumed_at = now()
      where id = $1 and consumed_at is null
      returning id`,
    [challenge.id],
  );
  if (consumed.rows.length === 0) return { ok: false, reason: 'used' };
  return { ok: true };
}

/**
 * Was this number verified recently enough to complete a registration?
 *
 * Registration is a two-step flow — verify, then submit — so the consumed
 * challenge is the evidence that the second step is entitled to proceed.
 */
export async function recentlyVerified(
  db: Db,
  phoneE164: string,
  purpose: OtpPurpose,
  withinSeconds = 30 * 60,
): Promise<boolean> {
  const found = await db.query<{ id: string }>(
    `select id from otp_challenges
      where phone_e164 = $1 and purpose = $2 and consumed_at is not null
        and consumed_at > now() - make_interval(secs => $3)
      limit 1`,
    [phoneE164, purpose, withinSeconds],
  );
  return found.rows.length > 0;
}
