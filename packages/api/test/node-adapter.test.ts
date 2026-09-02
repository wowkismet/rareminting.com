import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, reset, sellerBody } from './helpers.ts';
import { createNodeServer } from '../src/node-adapter.ts';

/**
 * The node:http adapter, driven over a real socket.
 *
 * Every other test in this package calls app.handle() with a Request it built
 * itself, which skips this layer entirely. A photograph upload once reached
 * production without a single test having sent a multipart body through a
 * socket; these tests close that gap.
 */

let pg: PGlite;
let server: Server;
let base: string;
let uploadDir: string;

before(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'rm-adapter-'));
  process.env['UPLOAD_DIR'] = uploadDir;

  const rig = await createRig();
  pg = rig.pg;

  server = createNodeServer(rig.app, 'http://127.0.0.1');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pg.close();
  // Only this test's own scratch directory, created above.
  await rm(uploadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await reset(pg);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 0]);

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Register, become a seller, and create a listing. Returns token and id. */
async function sellerWithListing(
  email: string,
): Promise<{ token: string; listingId: string }> {
  const reg = await fetch(`${base}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery' }),
  });
  assert.equal(reg.status, 201);
  const token = (await json(reg))['token'] as string;

  const auth = { authorization: `Bearer ${token}` };
  await fetch(`${base}/v1/sellers`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(sellerBody({ fullName: 'Adapter Test' })),
  });

  const created = await fetch(`${base}/v1/listings`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      serial: '8PP 010270',
      denomination: 100,
      series: 'Mahatma Gandhi Series',
      priceInr: 2500,
    }),
  });
  assert.equal(created.status, 201);
  const listing = (await json(created))['listing'] as { id: string };
  return { token, listingId: listing.id };
}

describe('node:http adapter', () => {
  it('carries a multipart upload through a socket', async () => {
    const { token, listingId } = await sellerWithListing('adapter-upload@example.com');

    const form = new FormData();
    form.set('file', new Blob([PNG], { type: 'image/png' }), 'note.png');
    form.set('kind', 'obverse');

    const res = await fetch(`${base}/v1/listings/${listingId}/media`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });

    assert.equal(res.status, 201);
    const media = (await json(res))['media'] as { url: string; contentType: string; bytes: number };
    assert.equal(media.contentType, 'image/png');
    assert.equal(media.bytes, PNG.length);
    assert.match(media.url, /^\/media\//);
  });

  it('carries a JSON body through a socket', async () => {
    const res = await fetch(`${base}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'adapter-json@example.com', password: 'correct horse battery' }),
    });
    assert.equal(res.status, 201);
    assert.ok(typeof (await json(res))['token'] === 'string');
  });

  it('handles a POST with no body at all', async () => {
    // An empty body must not be turned into a Request the router chokes on.
    const res = await fetch(`${base}/v1/auth/login`, { method: 'POST' });
    assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
  });

  it('preserves the status and content type of a GET', async () => {
    const res = await fetch(`${base}/v1/listings?limit=1`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  });

  it('404s an unknown path rather than hanging', async () => {
    const res = await fetch(`${base}/v1/nothing-here`);
    assert.equal(res.status, 404);
  });
});
