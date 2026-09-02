import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { adapt, createRig, reset } from './helpers.ts';
import type { Database } from '../src/db.ts';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  generateCode,
  issueMobileOtp,
  otpAvailable,
  recentlyVerified,
  verifyMobileOtp,
} from '../src/otp.ts';

/**
 * One-time passcodes.
 *
 * The properties worth holding onto are the ones that stop a six-digit secret
 * being guessable: codes expire, are single-use, cost an attempt when wrong,
 * and are capped both per challenge and per number.
 */

let pg: PGlite;
let db: Database;

/** The console sender prints the code; that is how a test learns it. */
const sent: { target: string; code: string }[] = [];
const realLog = console.log;

before(async () => {
  process.env['SMS_PROVIDER'] = 'console';
  delete process.env['NODE_ENV'];

  const rig = await createRig();
  pg = rig.pg;
  db = adapt(pg);

  console.log = (...args: unknown[]): void => {
    const line = String(args[0] ?? '');
    const match = /^\[otp\] (\S+) -> (\d{6})$/.exec(line);
    if (match !== null) sent.push({ target: match[1]!, code: match[2]! });
    else realLog(...args);
  };
});

after(async () => {
  console.log = realLog;
  delete process.env['SMS_PROVIDER'];
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
  sent.length = 0;
});

const MOBILE = '+919812345678';

async function issue(mobile = MOBILE): Promise<string> {
  const result = await issueMobileOtp(db, mobile, 'seller_mobile');
  assert.ok(result.ok, 'the challenge was not issued');
  const last = sent.at(-1);
  assert.ok(last !== undefined, 'nothing was sent');
  return last.code;
}

describe('generateCode', () => {
  it('is always six digits, leading zeros kept', () => {
    for (let i = 0; i < 500; i += 1) {
      assert.match(generateCode(), /^\d{6}$/);
    }
  });
});

describe('availability', () => {
  it('reports available with a sender configured', () => {
    assert.equal(otpAvailable(), true);
  });

  it('reports unavailable with no provider, and refuses to issue', async () => {
    const provider = process.env['SMS_PROVIDER'];
    delete process.env['SMS_PROVIDER'];
    try {
      assert.equal(otpAvailable(), false);
      const result = await issueMobileOtp(db, MOBILE, 'seller_mobile');
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.reason, 'unavailable');
    } finally {
      process.env['SMS_PROVIDER'] = provider;
    }
  });

  it('will not use the console sender in production', async () => {
    process.env['NODE_ENV'] = 'production';
    try {
      assert.equal(otpAvailable(), false, 'a development sender was live in production');
    } finally {
      delete process.env['NODE_ENV'];
    }
  });
});

describe('verifying', () => {
  it('accepts the right code once', async () => {
    const code = await issue();
    assert.deepEqual(await verifyMobileOtp(db, MOBILE, 'seller_mobile', code), { ok: true });

    // Single use: the same code must not work twice.
    const again = await verifyMobileOtp(db, MOBILE, 'seller_mobile', code);
    assert.equal(again.ok, false);
    assert.equal(again.ok === false && again.reason, 'used');
  });

  it('rejects a wrong code and spends an attempt', async () => {
    const code = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    const result = await verifyMobileOtp(db, MOBILE, 'seller_mobile', wrong);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'wrong');

    const row = await pg.query<{ attempts: number }>(`select attempts from otp_challenges`);
    assert.equal(row.rows[0]!.attempts, 1);
  });

  it('locks the challenge after too many wrong codes', async () => {
    const code = await issue();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await verifyMobileOtp(db, MOBILE, 'seller_mobile', wrong);
    }

    // Even the correct code is refused once the attempts are spent.
    const result = await verifyMobileOtp(db, MOBILE, 'seller_mobile', code);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'exhausted');
  });

  it('refuses an expired code', async () => {
    const code = await issue();
    await pg.query(`update otp_challenges set expires_at = now() - interval '1 minute'`);

    const result = await verifyMobileOtp(db, MOBILE, 'seller_mobile', code);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'expired');
  });

  it('refuses a code for a number that has none', async () => {
    const result = await verifyMobileOtp(db, '+919800000000', 'seller_mobile', '123456');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'not_found');
  });

  it('will not replay a code against a different number', async () => {
    const code = await issue();
    await issueMobileOtp(db, '+919800000001', 'seller_mobile');

    const result = await verifyMobileOtp(db, '+919800000001', 'seller_mobile', code);
    assert.equal(result.ok, false, 'a code minted for one number worked for another');
  });

  it('will not replay a code against a different purpose', async () => {
    const code = await issue();
    // A code sent to verify a mobile must not sign anybody in.
    await issueMobileOtp(db, MOBILE, 'login');
    const result = await verifyMobileOtp(db, MOBILE, 'login', code);
    assert.equal(result.ok, false, 'a seller_mobile code worked for login');
  });

  it('stores the code hashed, never in the clear', async () => {
    const code = await issue();
    const rows = await pg.query<{ code_hash: string }>(`select code_hash from otp_challenges`);
    const hash = rows.rows[0]!.code_hash;
    assert.equal(hash.includes(code), false, 'the code is recoverable from the table');
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe('rate limiting', () => {
  it('caps challenges per number per hour', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i += 1) {
      const result = await issueMobileOtp(db, MOBILE, 'seller_mobile');
      assert.ok(result.ok, `challenge ${i} was refused early`);
    }

    const blocked = await issueMobileOtp(db, MOBILE, 'seller_mobile');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.ok === false && blocked.reason, 'rate_limited');
  });

  it('counts the cap per number, not globally', async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i += 1) {
      await issueMobileOtp(db, MOBILE, 'seller_mobile');
    }
    const other = await issueMobileOtp(db, '+919800000002', 'seller_mobile');
    assert.ok(other.ok, 'one number exhausting its cap blocked another');
  });
});

describe('recentlyVerified', () => {
  it('is true just after a successful verification', async () => {
    const code = await issue();
    await verifyMobileOtp(db, MOBILE, 'seller_mobile', code);
    assert.equal(await recentlyVerified(db, MOBILE, 'seller_mobile'), true);
  });

  it('is false when the verification has aged out', async () => {
    const code = await issue();
    await verifyMobileOtp(db, MOBILE, 'seller_mobile', code);
    await pg.query(`update otp_challenges set consumed_at = now() - interval '2 hours'`);
    assert.equal(await recentlyVerified(db, MOBILE, 'seller_mobile'), false);
  });

  it('is false for a challenge that was never completed', async () => {
    await issue();
    assert.equal(await recentlyVerified(db, MOBILE, 'seller_mobile'), false);
  });
});
