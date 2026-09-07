import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';

import { createRig, request, reset } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Banners.
 *
 * Two things are worth testing hardest: that the schedule is honoured, so a
 * Republic Day banner is not still up in March; and that a link cannot leave
 * the site, because a promotional link is exactly what gets copied into an
 * email and an open redirect is one however trusted whoever typed it.
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
  await pg.query(`delete from banners`);
});

let n = 0;

async function staff(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `ban${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [body.user.id]);
  return body.token;
}

/** Post a banner as multipart, without going near a socket. */
async function put(token: string, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const packed = new Response(form);
  const contentType = packed.headers.get('content-type') ?? '';
  const body = await packed.arrayBuffer();

  return app.handle(
    new Request('http://local/v1/admin/banners', {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    }),
  );
}

async function live(slot: string): Promise<{ headline: string; href: string | null }[]> {
  const res = await request(app, 'GET', `/v1/banners?slot=${slot}`);
  assert.equal(res.status, 200, await res.clone().text());
  return ((await res.json()) as { banners: { headline: string; href: string | null }[] }).banners;
}

describe('banners', () => {
  it('is readable without signing in — it is on the homepage', async () => {
    const res = await request(app, 'GET', '/v1/banners?slot=home_hero');
    assert.equal(res.status, 200);
  });

  it('only staff may put one up', async () => {
    n += 1;
    const reg = await request(app, 'POST', '/v1/auth/register', {
      body: { email: `banx${n}@example.com`, password: 'correct horse battery' },
    });
    const { token } = (await reg.json()) as { token: string };
    const res = await put(token, { slot: 'home_hero', headline: 'Mine now' });
    assert.equal(res.status, 404);
  });

  it('shows a live one in its slot and nowhere else', async () => {
    const token = await staff();
    await put(token, { slot: 'home_hero', headline: 'Diwali at Rare Minting' });

    assert.equal((await live('home_hero')).length, 1);
    assert.equal((await live('cart')).length, 0, 'a banner belongs to one place');
  });

  it('needs a headline, because that is what somebody reads', async () => {
    const token = await staff();
    const res = await put(token, { slot: 'home_hero', headline: '   ' });
    assert.equal(res.status, 400);
  });

  it('refuses a link that leaves the site', async () => {
    const token = await staff();
    for (const href of ['https://evil.example', '//evil.example', 'javascript:alert(1)']) {
      await put(token, { slot: 'browse', headline: `Try ${href}`, href });
    }
    const shown = await live('browse');
    assert.equal(shown.length, 3, 'the banners are kept');
    assert.ok(
      shown.every((b) => b.href === null),
      'but every off-site link is dropped rather than stored',
    );
  });

  it('keeps a link that stays on the site', async () => {
    const token = await staff();
    await put(token, { slot: 'browse', headline: 'Lucky numbers', href: '/browse?pattern=lucky' });
    assert.equal((await live('browse'))[0]?.href, '/browse?pattern=lucky');
  });

  it('does not show one before it starts', async () => {
    const token = await staff();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await put(token, { slot: 'cart', headline: 'Not yet', startsAt: tomorrow });
    assert.equal((await live('cart')).length, 0);
  });

  it('stops showing one after it ends', async () => {
    const token = await staff();
    await put(token, { slot: 'cart', headline: 'Republic Day' });
    await pg.query(`update banners set ends_at = now() - interval '1 day'`);
    assert.equal(
      (await live('cart')).length,
      0,
      'a window is what stops a January banner running in March',
    );
  });

  it('hides one that has been turned off', async () => {
    const token = await staff();
    await put(token, { slot: 'home_mid', headline: 'Paused' });
    await pg.query(`update banners set is_active = false`);
    assert.equal((await live('home_mid')).length, 0);
  });

  it('rejects a slot that is not a slot', async () => {
    const token = await staff();
    assert.equal((await put(token, { slot: 'everywhere', headline: 'Hi' })).status, 400);
    assert.equal((await request(app, 'GET', '/v1/banners?slot=everywhere')).status, 400);
  });

  it('will not store an image nobody can describe', async () => {
    // The constraint is the guarantee, not the form: a banner row with an
    // image and no description should be impossible however it is created.
    await assert.rejects(
      pg.query(
        `insert into banners (slot, headline, storage_key) values ('cart', 'No alt', 'banners/x.png')`,
      ),
      'an image with no description is unusable to anybody using a screen reader',
    );
  });
});
