import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * The endpoints behind the admin console's menu.
 *
 * Every one of these is here to execute its SQL against a real Postgres. The
 * overview once shipped a query against a table that had never existed and
 * typechecked perfectly, because TypeScript does not read SQL strings. These
 * assert little about the contents and everything about the query running.
 */

let pg: PGlite;
let app: App;

before(async () => {
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await reset(pg);
});

let accounts = 0;

async function makeAdmin(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `adm${accounts}@example.com`, password: 'correct horse battery' },
  });
  const { token, user } = (await res.json()) as { token: string; user: { id: string } };
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [user.id]);
  return token;
}

async function plainUser(): Promise<string> {
  accounts += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `usr${accounts}@example.com`, password: 'correct horse battery' },
  });
  return ((await res.json()) as { token: string }).token;
}

const PAGES = [
  ['/v1/admin/users', 'users'],
  ['/v1/admin/orders', 'orders'],
  ['/v1/admin/transactions', 'transactions'],
  ['/v1/admin/reviews', 'reviews'],
  ['/v1/admin/categories', 'categories'],
  ['/v1/admin/audit', 'entries'],
] as const;

describe('the admin console pages', () => {
  for (const [path, key] of PAGES) {
    it(`${path} runs its query and answers a list`, async () => {
      const token = await makeAdmin();
      const res = await request(app, 'GET', path, { token });
      assert.equal(res.status, 200, await res.clone().text());

      const body = (await res.json()) as Record<string, unknown>;
      assert.ok(Array.isArray(body[key]), `${path} should answer with ${key} as an array`);
    });

    it(`${path} is closed to a signed-in non-admin`, async () => {
      const token = await plainUser();
      const res = await request(app, 'GET', path, { token });
      assert.equal(
        res.status,
        404,
        'a 403 would confirm the console exists to someone who should not know',
      );
    });
  }

  it('filters users by email', async () => {
    const token = await makeAdmin();
    const res = await request(app, 'GET', '/v1/admin/users?q=adm', { token });
    assert.equal(res.status, 200, await res.clone().text());

    const { users } = (await res.json()) as { users: { email: string }[] };
    assert.ok(users.length >= 1, 'the admin itself should match');
    assert.ok(users.every((u) => u.email.includes('adm')));
  });

  it('never returns a password hash with a user', async () => {
    const token = await makeAdmin();
    const res = await request(app, 'GET', '/v1/admin/users', { token });
    const text = await res.text();

    assert.ok(!text.includes('password'), 'no password field should reach the console');
    assert.ok(!text.includes('$argon'), 'no hash should reach the console');
  });
});
