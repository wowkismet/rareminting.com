import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, reset, sellerBody, TEST_IP } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * Photograph uploads.
 *
 * The interesting cases are the hostile ones: a file that claims to be an image
 * but is not, a filename crafted to escape the upload directory, and a seller
 * reaching for someone else's listing.
 */

let pg: PGlite;
let app: App;
let uploadDir: string;

before(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'rm-uploads-'));
  process.env['UPLOAD_DIR'] = uploadDir;

  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  await pg.close();
  // Only this test's own scratch directory, created above.
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await reset(pg);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 0]);

async function seller(email: string): Promise<string> {
  const reg = await app.handle(
    new Request('http://api.test/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery' }),
    }),
    TEST_IP,
  );
  const token = ((await reg.json()) as { token: string }).token;

  await app.handle(
    new Request('http://api.test/v1/sellers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(sellerBody({ fullName: 'Sunil Kapoor' })),
    }),
    TEST_IP,
  );
  return token;
}

async function listing(token: string, serial: string): Promise<string> {
  const res = await app.handle(
    new Request('http://api.test/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        serial,
        denomination: 100,
        series: 'Mahatma Gandhi New Series',
        priceInr: 4500,
      }),
    }),
    TEST_IP,
  );
  return ((await res.json()) as { listing: { id: string } }).listing.id;
}

function upload(
  token: string | null,
  listingId: string,
  bytes: Uint8Array,
  filename: string,
  type: string,
  kind = 'obverse',
): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([bytes], filename, { type }), filename);
  form.set('kind', kind);

  return app.handle(
    new Request(`http://api.test/v1/listings/${listingId}/media`, {
      method: 'POST',
      ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
      body: form,
    }),
    TEST_IP,
  );
}

describe('uploading a photograph', () => {
  it('accepts a JPEG and returns a public URL', async () => {
    const token = await seller('m1@example.com');
    const id = await listing(token, '9AB 150892');

    const res = await upload(token, id, JPEG, 'note.jpg', 'image/jpeg');
    assert.equal(res.status, 201, await res.clone().text());

    const body = (await res.json()) as {
      media: { url: string; contentType: string; kind: string };
    };
    assert.match(body.media.url, /^\/media\//);
    assert.equal(body.media.contentType, 'image/jpeg');
    assert.equal(body.media.kind, 'obverse');
  });

  it('accepts a PNG', async () => {
    const token = await seller('m2@example.com');
    const id = await listing(token, '9AB 150893');
    assert.equal((await upload(token, id, PNG, 'note.png', 'image/png')).status, 201);
  });

  it('keeps obverse and reverse apart, in upload order', async () => {
    const token = await seller('m3@example.com');
    const id = await listing(token, '9AB 150894');
    await upload(token, id, JPEG, 'front.jpg', 'image/jpeg', 'obverse');
    await upload(token, id, JPEG, 'back.jpg', 'image/jpeg', 'reverse');

    const res = await app.handle(new Request(`http://api.test/v1/listings/${id}/media`), TEST_IP);
    const body = (await res.json()) as { media: { kind: string; sortOrder: number }[] };
    assert.deepEqual(
      body.media.map((m) => m.kind),
      ['obverse', 'reverse'],
    );
    assert.ok(body.media[1]!.sortOrder > body.media[0]!.sortOrder);
  });
});

describe('rejecting what is not an image', () => {
  it('refuses a script that claims to be a JPEG', async () => {
    const token = await seller('m4@example.com');
    const id = await listing(token, '9AB 150895');

    const script = new TextEncoder().encode('<?php system($_GET["c"]); ?>            ');
    const res = await upload(token, id, script, 'shell.jpg', 'image/jpeg');

    assert.equal(res.status, 400, 'the declared type must not be trusted');
    assert.match(((await res.json()) as { message: string }).message, /JPEG, PNG or WebP/);
  });

  it('refuses an empty file', async () => {
    const token = await seller('m5@example.com');
    const id = await listing(token, '9AB 150896');
    assert.equal((await upload(token, id, new Uint8Array(), 'x.jpg', 'image/jpeg')).status, 400);
  });

  it('does not let a crafted filename escape the upload directory', async () => {
    const token = await seller('m6@example.com');
    const id = await listing(token, '9AB 150897');

    const res = await upload(token, id, JPEG, '../../../../etc/cron.d/pwned.jpg', 'image/jpeg');
    assert.equal(res.status, 201, 'the upload itself is fine; the name must simply be ignored');

    const body = (await res.json()) as { media: { url: string } };
    assert.ok(!body.media.url.includes('..'), 'no traversal may survive into the stored path');
    assert.ok(!body.media.url.includes('cron'), 'the submitted name must not be used at all');
    assert.match(body.media.url, new RegExp(`^/media/${id}/[0-9a-f-]{36}\\.jpg$`));
  });
});

describe('who may upload', () => {
  it('refuses an anonymous upload', async () => {
    const token = await seller('m7@example.com');
    const id = await listing(token, '9AB 150898');
    assert.equal((await upload(null, id, JPEG, 'x.jpg', 'image/jpeg')).status, 401);
  });

  it("refuses another seller's listing", async () => {
    const mine = await seller('m8@example.com');
    const id = await listing(mine, '9AB 150899');

    const theirs = await seller('m9@example.com');
    const res = await upload(theirs, id, JPEG, 'x.jpg', 'image/jpeg');
    assert.equal(res.status, 403);
  });

  it('404s an unknown listing', async () => {
    const token = await seller('m10@example.com');
    const res = await upload(
      token,
      '00000000-0000-0000-0000-000000000000',
      JPEG,
      'x.jpg',
      'image/jpeg',
    );
    assert.equal(res.status, 404);
  });
});
