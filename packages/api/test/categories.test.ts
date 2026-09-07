import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Managing categories.
 *
 * The slug is the interesting part: it is the address a link points at, so it
 * is derived once and then fixed. A category that quietly moves takes every
 * shared link with it.
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
  await pg.query(`delete from categories`);
});

let n = 0;

async function staff(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `cat${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [body.user.id]);
  return body.token;
}

async function create(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; id?: string; slug?: string }> {
  const res = await request(app, 'POST', '/v1/admin/categories', { token, body });
  if (res.status !== 201) return { status: res.status };
  const out = (await res.json()) as { category: { id: string; slug: string } };
  return { status: res.status, id: out.category.id, slug: out.category.slug };
}

describe('categories', () => {
  it('is closed to everybody but staff', async () => {
    n += 1;
    const reg = await request(app, 'POST', '/v1/auth/register', {
      body: { email: `catx${n}@example.com`, password: 'correct horse battery' },
    });
    const { token } = (await reg.json()) as { token: string };

    const res = await request(app, 'POST', '/v1/admin/categories', {
      token,
      body: { name: 'Sneaky', kind: 'coin' },
    });
    assert.equal(res.status, 404);
  });

  it('makes an address out of the name', async () => {
    const token = await staff();
    const made = await create(token, { name: 'Princely State Coins', kind: 'coin' });
    assert.equal(made.status, 201);
    assert.equal(made.slug, 'princely-state-coins');
  });

  it('refuses two categories at the same address', async () => {
    const token = await staff();
    await create(token, { name: 'Rare Coins', kind: 'coin' });
    const second = await create(token, { name: 'rare coins', kind: 'coin' });
    assert.equal(second.status, 409, 'two things cannot live at one address');
  });

  it('refuses a name with no letters or numbers to build an address from', async () => {
    const token = await staff();
    const made = await create(token, { name: '!!! ???', kind: 'coin' });
    assert.equal(made.status, 400);
  });

  it('refuses a kind that is not a kind', async () => {
    const token = await staff();
    const made = await create(token, { name: 'Spaceships', kind: 'spacecraft' });
    assert.equal(made.status, 400);
  });

  it('renames without moving the address', async () => {
    const token = await staff();
    const made = await create(token, { name: 'Old Name', kind: 'coin' });

    const res = await request(app, 'PATCH', `/v1/admin/categories/${made.id}`, {
      token,
      body: { name: 'A Much Better Name' },
    });
    assert.equal(res.status, 200, await res.clone().text());

    const row = await pg.query<{ name: string; slug: string }>(
      `select name, slug from categories where id = $1`,
      [made.id],
    );
    assert.equal(row.rows[0]?.name, 'A Much Better Name');
    assert.equal(row.rows[0]?.slug, 'old-name', 'the address must survive a rename');
  });

  it('will not remove one with categories inside it', async () => {
    const token = await staff();
    const parent = await create(token, { name: 'Coins', kind: 'coin' });
    await create(token, { name: 'Mughal', kind: 'coin', parentId: parent.id });

    const res = await request(app, 'DELETE', `/v1/admin/categories/${parent.id}`, { token });
    assert.equal(res.status, 409, 'the children would be orphaned at the top level');
  });

  it('removes an empty one, and records who did', async () => {
    const token = await staff();
    const made = await create(token, { name: 'A Mistake', kind: 'other' });

    const res = await request(app, 'DELETE', `/v1/admin/categories/${made.id}`, { token });
    assert.equal(res.status, 200);

    const left = await pg.query<{ n: string }>(
      `select count(*)::text as n from categories where id = $1`,
      [made.id],
    );
    assert.equal(left.rows[0]?.n, '0');

    const logged = await pg.query<{ n: string }>(
      `select count(*)::text as n from audit_logs where action = 'category.delete'`,
    );
    assert.equal(logged.rows[0]?.n, '1');
  });

  it('rejects a parent that does not exist', async () => {
    const token = await staff();
    const made = await create(token, {
      name: 'Orphan',
      kind: 'coin',
      parentId: '00000000-0000-0000-0000-000000000000',
    });
    assert.equal(made.status, 400);
  });
});
