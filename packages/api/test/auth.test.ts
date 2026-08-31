import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * End-to-end against the real schema and the real handlers. PGlite gives us
 * genuine PostgreSQL, so constraints, triggers and SQL all behave as they will
 * in production — and no server or port is involved.
 */

let db: PGlite;
let app: App;


before(async () => {
  const rig = await createRig();
  db = rig.pg;
  app = rig.app;
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await reset(db);
});

const IP = '203.0.113.7';

function post(path: string, body: unknown, token?: string): Promise<Response> {
  return app.handle(
    new Request(`http://api.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    }),
    IP,
  );
}

function get(path: string, token?: string): Promise<Response> {
  return app.handle(
    new Request(`http://api.test${path}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
    IP,
  );
}

const GOOD = { email: 'Asha@Example.com', password: 'correct horse battery', fullName: 'Asha R' };

async function registerOk(overrides: Record<string, unknown> = {}): Promise<{
  token: string;
  userId: string;
}> {
  const res = await post('/v1/auth/register', { ...GOOD, ...overrides });
  assert.equal(res.status, 201, await res.clone().text());
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

describe('health', () => {
  it('answers', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

describe('routing', () => {
  it('404s an unknown path', async () => {
    assert.equal((await get('/v1/nope')).status, 404);
  });

  it('405s a known path with the wrong method', async () => {
    const res = await get('/v1/auth/login');
    assert.equal(res.status, 405);
  });

  it('rejects a malformed JSON body with 400, not 500', async () => {
    const res = await app.handle(
      new Request('http://api.test/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      IP,
    );
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /valid JSON/i);
  });
});

describe('registration', () => {
  it('creates an account, assigns the buyer role and returns a session', async () => {
    const res = await post('/v1/auth/register', GOOD);
    assert.equal(res.status, 201);

    const body = (await res.json()) as {
      token: string;
      user: { email: string; roles: string[]; emailVerified: boolean; fullName: string };
    };
    assert.equal(body.user.email, 'asha@example.com', 'email should be normalised to lowercase');
    assert.deepEqual(body.user.roles, ['buyer']);
    assert.equal(body.user.emailVerified, false, 'a fresh account is unverified');
    assert.equal(body.user.fullName, 'Asha R');
    assert.ok(body.token.length > 20);
  });

  it('never returns the password hash', async () => {
    const res = await post('/v1/auth/register', GOOD);
    const text = await res.text();
    assert.ok(!text.includes('scrypt'), 'response leaked the password hash');
    assert.ok(!text.includes(GOOD.password), 'response leaked the password');
  });

  it('stores the password hashed, not in the clear', async () => {
    await registerOk();
    const rows = await db.query<{ password_hash: string }>(`select password_hash from users`);
    const hash = rows.rows[0]!.password_hash;
    assert.ok(hash.startsWith('scrypt$'));
    assert.ok(!hash.includes(GOOD.password));
  });

  it('refuses a duplicate address regardless of case', async () => {
    await registerOk();
    const res = await post('/v1/auth/register', { ...GOOD, email: 'ASHA@example.com' });
    assert.equal(res.status, 409);
  });

  it('rejects a short password with a useful message', async () => {
    const res = await post('/v1/auth/register', { ...GOOD, password: 'short' });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { message: string; details: Record<string, string> };
    assert.match(body.message, /at least 10 characters/);
    assert.equal(body.details['password'], 'too_short');
  });

  it('rejects a malformed email', async () => {
    const res = await post('/v1/auth/register', { ...GOOD, email: 'not-an-email' });
    assert.equal(res.status, 400);
  });

  it('rejects a phone number that is not E.164', async () => {
    const res = await post('/v1/auth/register', { ...GOOD, phone: '9876543210' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { message: string }).message, /international format/i);
  });

  it('accepts a valid E.164 phone number', async () => {
    const res = await post('/v1/auth/register', { ...GOOD, phone: '+91 98765 43210' });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { user: { phone: string } };
    assert.equal(body.user.phone, '+919876543210', 'spaces should be stripped');
  });

  it('writes an audit record', async () => {
    const { userId } = await registerOk();
    const rows = await db.query<{ action: string; entity_id: string }>(
      `select action, entity_id from audit_logs`,
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.action, 'user.register');
    assert.equal(rows.rows[0]!.entity_id, userId);
  });
});

describe('login', () => {
  it('succeeds with the right password', async () => {
    await registerOk();
    const res = await post('/v1/auth/login', { email: GOOD.email, password: GOOD.password });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string };
    assert.ok(body.token.length > 20);
  });

  it('fails with the wrong password', async () => {
    await registerOk();
    const res = await post('/v1/auth/login', { email: GOOD.email, password: 'wrong password!!' });
    assert.equal(res.status, 401);
  });

  it('gives the identical answer for an unknown account and a wrong password', async () => {
    await registerOk();
    const wrong = await post('/v1/auth/login', {
      email: GOOD.email,
      password: 'wrong password!!',
    });
    const missing = await post('/v1/auth/login', {
      email: 'nobody@example.com',
      password: 'wrong password!!',
    });
    assert.equal(wrong.status, missing.status);
    assert.deepEqual(await wrong.json(), await missing.json(), 'responses must not be distinguishable');
  });

  it('issues a distinct token each time', async () => {
    await registerOk();
    const a = (await (await post('/v1/auth/login', { email: GOOD.email, password: GOOD.password })).json()) as { token: string };
    const b = (await (await post('/v1/auth/login', { email: GOOD.email, password: GOOD.password })).json()) as { token: string };
    assert.notEqual(a.token, b.token);
  });

  it('stores only the hash of the token', async () => {
    await registerOk();
    const res = await post('/v1/auth/login', { email: GOOD.email, password: GOOD.password });
    const { token } = (await res.json()) as { token: string };
    const rows = await db.query<{ token_hash: string }>(`select token_hash from sessions`);
    for (const row of rows.rows) {
      assert.notEqual(row.token_hash, token, 'the raw token must never be stored');
    }
  });

  it('throttles after repeated failures for one identifier', async () => {
    await registerOk();
    let throttled = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await post('/v1/auth/login', { email: GOOD.email, password: 'wrong password!!' });
      if (res.status === 429) {
        throttled = true;
        assert.match(((await res.json()) as { message: string }).message, /Too many sign-in attempts/);
        break;
      }
    }
    assert.ok(throttled, 'expected the account to be throttled');
  });

  it('still lets a correct password through before the limit is hit', async () => {
    await registerOk();
    await post('/v1/auth/login', { email: GOOD.email, password: 'wrong password!!' });
    const res = await post('/v1/auth/login', { email: GOOD.email, password: GOOD.password });
    assert.equal(res.status, 200);
  });
});

describe('sessions', () => {
  it('resolves the current user from a bearer token', async () => {
    const { token, userId } = await registerOk();
    const res = await get('/v1/auth/me', token);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { id: string; email: string } };
    assert.equal(body.user.id, userId);
    assert.equal(body.user.email, 'asha@example.com');
  });

  it('rejects a missing token', async () => {
    assert.equal((await get('/v1/auth/me')).status, 401);
  });

  it('rejects a forged token', async () => {
    await registerOk();
    assert.equal((await get('/v1/auth/me', 'not-a-real-token')).status, 401);
  });

  it('rejects a token after logout', async () => {
    const { token } = await registerOk();
    assert.equal((await post('/v1/auth/logout', {}, token)).status, 204);
    assert.equal((await get('/v1/auth/me', token)).status, 401);
  });

  it('logout-all ends every session', async () => {
    const { token } = await registerOk();
    const second = (await (await post('/v1/auth/login', {
      email: GOOD.email,
      password: GOOD.password,
    })).json()) as { token: string };

    const res = await post('/v1/auth/logout-all', {}, token);
    assert.equal(res.status, 200);
    assert.ok(((await res.json()) as { revoked: number }).revoked >= 2);

    assert.equal((await get('/v1/auth/me', token)).status, 401);
    assert.equal((await get('/v1/auth/me', second.token)).status, 401);
  });

  it('rejects an expired session', async () => {
    const { token } = await registerOk();
    // Both timestamps move back: sessions_window forbids expiry before issue,
    // so a session has to be aged rather than given an impossible expiry.
    await db.query(
      `update sessions
          set issued_at  = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'`,
    );
    assert.equal((await get('/v1/auth/me', token)).status, 401);
  });

  it('rejects a session whose user is suspended', async () => {
    const { token, userId } = await registerOk();
    await db.query(`update users set status = 'suspended' where id = $1`, [userId]);
    assert.equal((await get('/v1/auth/me', token)).status, 401);
  });
});
