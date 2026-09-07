/**
 * KYC documents: a PAN card, a masked Aadhaar, a cancelled cheque.
 *
 * These are not photographs of banknotes and are deliberately not stored like
 * them. Listing images live under the uploads directory, which nginx serves
 * straight to the internet at /media/ with no authentication — correct for a
 * note somebody is trying to sell, catastrophic for a PAN card. So these go to
 * a separate directory nginx knows nothing about, and are only ever handed out
 * by the route below, which checks who is asking.
 *
 * Every time staff open one, that is written to the audit trail. Looking at
 * somebody's identity document is an action, not a page view.
 *
 * What is still not stored: the numbers themselves. A PAN and an Aadhaar
 * become a one-way fingerprint and their last four characters at registration
 * and never exist here in a readable form. The masked Aadhaar image is
 * required to be masked for the same reason — the reviewer's job is to check
 * the last four against the fingerprint, which masking does not prevent.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.ts';
import { one, type Database } from '../db.ts';

/** Never inside the uploads directory nginx publishes. */
const KYC_DIR = process.env['KYC_DIR'] ?? '/srv/rareminting/kyc';

const MAX_BYTES = 8 * 1024 * 1024;

/** What a seller may send, and what each is for. */
const DOC_KINDS = {
  pan: 'PAN card',
  aadhaar_masked: 'Aadhaar (masked)',
  bank_proof: 'Cancelled cheque or passbook',
  address_proof: 'Proof of address',
  gst_certificate: 'GST certificate',
} as const;

type DocKind = keyof typeof DOC_KINDS;

/** Magic numbers, so the extension a browser claims is never trusted. */
function detect(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { mime: 'application/pdf', extension: 'pdf' };
  }
  return null;
}

async function sellerOf(ctx: Ctx, userId: string): Promise<string | null> {
  const row = one(
    await ctx.db.query<{ id: string }>(`select id from sellers where user_id = $1`, [userId]),
  );
  return row?.id ?? null;
}

async function isStaff(ctx: Ctx, userId: string): Promise<boolean> {
  const roles = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 and role = 'admin'`,
    [userId],
  );
  return roles.rows.length > 0;
}

export function registerKycDocumentRoutes(router: Router, _database: Database): void {
  /** POST /v1/sellers/me/documents — send one in. */
  router.add('POST', '/v1/sellers/me/documents', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const sellerId = await sellerOf(ctx, ctx.session.userId);
    if (sellerId === null) throw forbidden('Register as a seller first.');

    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw badRequest('Send the document as multipart form data.');
    }

    const kindValue = form.get('kind');
    if (typeof kindValue !== 'string' || !(kindValue in DOC_KINDS)) {
      throw badRequest(`Say which document this is: ${Object.keys(DOC_KINDS).join(', ')}.`, {
        kind: 'unknown',
      });
    }
    const kind = kindValue as DocKind;

    const file = form.get('file');
    if (!(file instanceof File)) throw badRequest('Attach the document in the "file" field.');
    if (file.size === 0) throw badRequest('That file is empty.');
    if (file.size > MAX_BYTES) {
      throw badRequest(`Documents must be ${MAX_BYTES / 1024 / 1024} MB or smaller.`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detect(bytes);
    if (detected === null) {
      throw badRequest('That must be a JPEG, PNG, WebP or PDF.');
    }

    // The name is generated here. Nothing the uploader sent reaches the
    // filesystem, so a crafted filename cannot escape the directory.
    const id = randomUUID();
    const storageKey = `${sellerId}/${id}.${detected.extension}`;
    const target = path.join(KYC_DIR, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o600 });

    // One row per kind, carrying both the fingerprint from registration and
    // the image. Registration already created a `pan` row holding the hash and
    // last four characters, so uploading the card attaches to that rather than
    // creating a second row a reviewer would have to reconcile.
    //
    // Re-uploading replaces the image and returns the document to pending: a
    // seller who sends a clearer photograph after a rejection needs it looked
    // at again, and silently leaving it rejected would strand them.
    const existing = one(
      await ctx.db.query<{ id: string }>(
        `select id from kyc_documents
          where seller_id = $1 and kind = $2::kyc_doc_kind
          order by created_at desc limit 1`,
        [sellerId, kind],
      ),
    );

    const saved =
      existing === null
        ? await ctx.db.query<{ id: string }>(
            `insert into kyc_documents (seller_id, kind, storage_key, state)
             values ($1, $2::kyc_doc_kind, $3, 'pending')
             returning id`,
            [sellerId, kind, storageKey],
          )
        : await ctx.db.query<{ id: string }>(
            `update kyc_documents
                set storage_key = $2, state = 'pending', rejection_reason = null
              where id = $1
              returning id`,
            [existing.id, storageKey],
          );

    return json(
      {
        document: {
          id: saved.rows[0]!.id,
          kind,
          label: DOC_KINDS[kind],
          state: 'pending',
        },
      },
      201,
    );
  });

  /** GET /v1/sellers/me/documents — what this seller has sent. */
  router.add('GET', '/v1/sellers/me/documents', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const sellerId = await sellerOf(ctx, ctx.session.userId);
    if (sellerId === null) throw forbidden('Register as a seller first.');

    const rows = await ctx.db.query<{
      id: string;
      kind: string;
      state: string;
      number_last4: string | null;
      rejection_reason: string | null;
      created_at: string;
      has_file: boolean;
    }>(
      `select id, kind::text as kind, state::text as state, number_last4,
              rejection_reason, created_at::text as created_at,
              (storage_key is not null and storage_key <> '') as has_file
         from kyc_documents where seller_id = $1
        order by created_at desc`,
      [sellerId],
    );

    return json({
      documents: rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: DOC_KINDS[r.kind as DocKind] ?? r.kind,
        state: r.state,
        last4: r.number_last4,
        rejectionReason: r.rejection_reason,
        hasFile: r.has_file,
        createdAt: r.created_at,
      })),
      required: Object.entries(DOC_KINDS).map(([kind, label]) => ({ kind, label })),
    });
  });

  /**
   * GET /v1/kyc-documents/:id/file — the document itself.
   *
   * The only way one of these leaves the server. The seller who sent it, or
   * staff; nobody else, and never a public URL. A staff view is audited,
   * because opening somebody's identity document is an action rather than a
   * page view, and "who looked at this" is the first question after a leak.
   */
  router.add('GET', '/v1/kyc-documents/:id/file', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such document.');

    const doc = one(
      await ctx.db.query<{ id: string; seller_id: string; storage_key: string; kind: string }>(
        `select id, seller_id, storage_key, kind::text as kind
           from kyc_documents where id = $1`,
        [id],
      ),
    );
    if (doc === null || doc.storage_key === '') throw notFound('No such document.');

    const staff = await isStaff(ctx, userId);
    const mine = await sellerOf(ctx, userId);
    if (!staff && doc.seller_id !== mine) throw notFound('No such document.');

    if (staff) {
      await ctx.db.query(
        `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
         values ($1::uuid, 'admin', 'kyc.document.view', 'kyc_document', $2, $3::jsonb, $4::inet, $5)`,
        [userId, id, JSON.stringify({ kind: doc.kind }), ctx.ip, ctx.userAgent],
      );
    }

    // Resolve and confirm the path stays inside the directory. The key is
    // generated rather than supplied, so this cannot currently be violated —
    // it is here so that it still cannot be if that ever changes.
    const target = path.resolve(KYC_DIR, doc.storage_key);
    if (!target.startsWith(path.resolve(KYC_DIR) + path.sep)) {
      throw notFound('No such document.');
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(target);
    } catch {
      throw notFound('That document is no longer on file.');
    }

    const detected = detect(new Uint8Array(bytes));
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': detected?.mime ?? 'application/octet-stream',
        // Never cached, never indexed, never stored by an intermediary.
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    });
  });

  /** GET /v1/admin/sellers/:id/documents — everything staff need to decide. */
  router.add('GET', '/v1/admin/sellers/:id/documents', async (ctx: Ctx) => {
    if (ctx.session === null) throw unauthorized();
    if (!(await isStaff(ctx, ctx.session.userId))) throw notFound('Not found.');

    const sellerId = ctx.params['id'] ?? '';
    const rows = await ctx.db.query<{
      id: string;
      kind: string;
      state: string;
      number_last4: string | null;
      name_match_score: string | null;
      rejection_reason: string | null;
      created_at: string;
      has_file: boolean;
    }>(
      `select id, kind::text as kind, state::text as state, number_last4,
              name_match_score::text as name_match_score, rejection_reason,
              created_at::text as created_at,
              (storage_key is not null and storage_key <> '') as has_file
         from kyc_documents where seller_id = $1
        order by kind, created_at desc`,
      [sellerId],
    );

    return json({
      documents: rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: DOC_KINDS[r.kind as DocKind] ?? r.kind,
        state: r.state,
        last4: r.number_last4,
        nameMatches: r.name_match_score === null ? null : Number(r.name_match_score) >= 1,
        rejectionReason: r.rejection_reason,
        hasFile: r.has_file,
        createdAt: r.created_at,
      })),
    });
  });
}
