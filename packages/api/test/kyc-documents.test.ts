import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

import { approveSeller, createRig, request, reset, sellerBody } from './helpers.ts';
import type { App } from '../src/app.ts';

/**
 * KYC documents.
 *
 * The boundary is the whole feature. A PAN card must reach the seller who sent
 * it and staff, and nobody else — not another seller, not a signed-out
 * visitor, and never a public URL. Listing photographs are served straight off
 * disk by nginx at /media/; these are not, and these tests are what keeps that
 * true if somebody later moves the storage.
 */

let pg: PGlite;
let app: App;
let dir: string;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rm-kyc-'));
  process.env['KYC_DIR'] = dir;
  const rig = await createRig();
  pg = rig.pg;
  app = rig.app;
});

after(async () => {
  await pg.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await reset(pg);
});

let n = 0;

/** A one-pixel PNG, so the magic-number check passes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function seller(): Promise<{ token: string; id: string }> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `kyc${n}@example.com`, password: 'correct horse battery' },
  });
  const token = ((await res.json()) as { token: string }).token;
  const reg = await request(app, 'POST', '/v1/sellers', {
    token,
    body: sellerBody({ fullName: 'Kavya Kapoor' }),
  });
  const { seller: s } = (await reg.json()) as { seller: { id: string } };
  await approveSeller(pg, s.id);
  return { token, id: s.id };
}

async function staffToken(): Promise<string> {
  n += 1;
  const res = await request(app, 'POST', '/v1/auth/register', {
    body: { email: `kycadm${n}@example.com`, password: 'correct horse battery' },
  });
  const body = (await res.json()) as { token: string; user: { id: string } };
  await pg.query(`insert into user_roles (user_id, role) values ($1, 'admin')`, [body.user.id]);
  return body.token;
}

/**
 * Post a multipart form straight at the app.
 *
 * `new Response(form)` does the multipart encoding for us — boundary, headers
 * and all — without going anywhere near a socket. Both the body and its
 * content-type must come from the same Response, or the boundary in the header
 * will not match the one in the body.
 */
async function postForm(token: string, form: FormData): Promise<Response> {
  const packed = new Response(form);
  const contentType = packed.headers.get('content-type') ?? '';
  const body = await packed.arrayBuffer();

  return app.handle(
    new Request('http://local/v1/sellers/me/documents', {
      method: 'POST',
      body,
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    }),
  );
}

/** Upload a document, returning its id. */
async function upload(token: string, kind = 'pan'): Promise<string> {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new File([PNG], 'card.png', { type: 'image/png' }));

  const out = await postForm(token, form);
  assert.equal(out.status, 201, await out.clone().text());
  return ((await out.json()) as { document: { id: string } }).document.id;
}

describe('KYC documents', () => {
  it('needs a seller account', async () => {
    const res = await request(app, 'POST', '/v1/sellers/me/documents');
    assert.equal(res.status, 401);
  });

  it('accepts a PAN card and lists it back to its own seller', async () => {
    const s = await seller();
    const id = await upload(s.token, 'pan');

    const res = await request(app, 'GET', '/v1/sellers/me/documents', { token: s.token });
    assert.equal(res.status, 200);
    const { documents } = (await res.json()) as {
      documents: { id: string; kind: string; label: string; hasFile: boolean }[];
    };
    const found = documents.find((d) => d.id === id);
    assert.ok(found, 'the document should come back');
    assert.equal(found.kind, 'pan');
    assert.equal(found.hasFile, true);
  });

  it('accepts a masked Aadhaar and a cancelled cheque', async () => {
    const s = await seller();
    await upload(s.token, 'aadhaar_masked');
    await upload(s.token, 'bank_proof');

    const res = await request(app, 'GET', '/v1/sellers/me/documents', { token: s.token });
    const { documents } = (await res.json()) as { documents: { kind: string }[] };
    const kinds = documents.map((d) => d.kind);
    assert.ok(kinds.includes('aadhaar_masked'));
    assert.ok(kinds.includes('bank_proof'));
  });

  it('hands the file to the seller who sent it', async () => {
    const s = await seller();
    const id = await upload(s.token);

    const res = await request(app, 'GET', `/v1/kyc-documents/${id}/file`, { token: s.token });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  });

  it('refuses it to a different seller', async () => {
    const mine = await seller();
    const stranger = await seller();
    const id = await upload(mine.token);

    const res = await request(app, 'GET', `/v1/kyc-documents/${id}/file`, {
      token: stranger.token,
    });
    assert.equal(res.status, 404, 'a 403 would confirm somebody else’s document exists');
  });

  it('refuses it to a signed-out visitor', async () => {
    const s = await seller();
    const id = await upload(s.token);
    const res = await request(app, 'GET', `/v1/kyc-documents/${id}/file`);
    assert.equal(res.status, 401);
  });

  it('gives it to staff, and writes down that they looked', async () => {
    const s = await seller();
    const admin = await staffToken();
    const id = await upload(s.token);

    const res = await request(app, 'GET', `/v1/kyc-documents/${id}/file`, { token: admin });
    assert.equal(res.status, 200);

    const logged = await pg.query<{ n: string }>(
      `select count(*)::text as n from audit_logs
        where action = 'kyc.document.view' and entity_id = $1`,
      [id],
    );
    assert.equal(logged.rows[0]?.n, '1', 'opening an identity document is an action, not a view');
  });

  it('does not log the seller reading their own document', async () => {
    const s = await seller();
    const id = await upload(s.token);
    await request(app, 'GET', `/v1/kyc-documents/${id}/file`, { token: s.token });

    const logged = await pg.query<{ n: string }>(
      `select count(*)::text as n from audit_logs where action = 'kyc.document.view'`,
    );
    assert.equal(logged.rows[0]?.n, '0');
  });

  it('refuses a file that is not the image it claims to be', async () => {
    const s = await seller();
    const form = new FormData();
    form.set('kind', 'pan');
    form.set(
      'file',
      new File([Buffer.from('#!/bin/sh\nrm -rf /')], 'card.png', { type: 'image/png' }),
    );

    const out = await postForm(s.token, form);
    assert.equal(out.status, 400, 'the extension a browser claims is never the evidence');
  });

  it('supersedes rather than accumulates, so a reviewer sees one of each', async () => {
    const s = await seller();
    await upload(s.token, 'pan');
    await upload(s.token, 'pan');

    const res = await request(app, 'GET', '/v1/sellers/me/documents', { token: s.token });
    const { documents } = (await res.json()) as { documents: { kind: string }[] };
    assert.equal(
      documents.filter((d) => d.kind === 'pan').length,
      1,
      'a reviewer should not be choosing between three PAN cards',
    );
  });

  it('keeps the admin document list closed to everybody else', async () => {
    const s = await seller();
    const res = await request(app, 'GET', `/v1/admin/sellers/${s.id}/documents`, {
      token: s.token,
    });
    assert.equal(res.status, 404);
  });
});
