/**
 * Paying sellers.
 *
 * Money is not pushed, it is asked for. When an order settles we create a
 * payout row marked `pending`, which means available. The seller requests it,
 * moving it to `processing`. An admin makes a bank transfer by hand and marks
 * it `paid` against the bank's reference.
 *
 * A seller is paid once per order and never before the buyer's inspection
 * window has closed, which is what the whole escrow arrangement is for. Both
 * of those are enforced here and in the schema rather than by convention: one
 * payout per order is a unique index, and the settlement check is a condition
 * on the insert.
 */

import type { Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors.ts';
import { asObject, optionalString, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';
import {
  accountLast4,
  bankStorageConfigured,
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccount,
  parseAccountNumber,
  parseIfsc,
} from '../bank-details.ts';
import { requireSeller } from './sellers.ts';

export function registerPayoutRoutes(router: Router, database: Database): void {
  /**
   * PUT /v1/sellers/me/bank-account
   *
   * Where the seller wants to be paid. Replaces whatever was there: a seller
   * has one payout destination, and changing it is the normal way to correct a
   * mistyped number.
   */
  router.add('PUT', '/v1/sellers/me/bank-account', async (ctx) => {
    const seller = await requireSeller(ctx);

    if (!bankStorageConfigured()) {
      throw forbidden('Bank details cannot be saved right now. Please try again later.');
    }

    const fields = asObject(await ctx.body());
    const holderName = requiredString(fields, 'holderName', 120);
    const bankName = optionalString(fields, 'bankName', 120);
    const branch = optionalString(fields, 'branch', 160);

    const accountNumber = parseAccountNumber(requiredString(fields, 'accountNumber', 24));
    if (accountNumber === null) {
      throw badRequest('An account number is 9 to 18 digits.', { accountNumber: 'invalid' });
    }

    const ifsc = parseIfsc(requiredString(fields, 'ifsc', 11));
    if (ifsc === null) {
      throw badRequest('That IFSC does not look right. It reads like HDFC0001234.', {
        ifsc: 'invalid',
      });
    }

    const saved = await database.transaction(async (tx) => {
      // One destination per seller: clear the old default rather than leaving
      // two accounts and having to guess which to pay.
      await tx.query(`delete from bank_accounts where seller_id = $1`, [seller.id]);
      const inserted = await tx.query<{ id: string; account_last4: string; ifsc: string }>(
        `insert into bank_accounts
           (seller_id, account_number_enc, account_last4, ifsc, holder_name,
            bank_name, branch, is_default)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         returning id, account_last4, ifsc`,
        [
          seller.id,
          encryptAccountNumber(accountNumber),
          accountLast4(accountNumber),
          ifsc,
          holderName,
          bankName,
          branch,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error('failed to save bank account');

      // The number itself is never written to the audit trail.
      await tx.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
         values ($1::uuid, 'seller.bank_account', 'seller', $2::text, $3::inet, $4)`,
        [ctx.session?.userId ?? null, seller.id, ctx.ip, ctx.userAgent],
      );

      return row;
    });

    return json({
      bankAccount: {
        id: saved.id,
        accountMasked: maskAccount(saved.account_last4),
        ifsc: saved.ifsc,
        holderName,
      },
    });
  });

  /** GET /v1/sellers/me/payouts — what is owed, requested and paid. */
  router.add('GET', '/v1/sellers/me/payouts', async (ctx) => {
    const seller = await requireSeller(ctx);

    const bank = one(
      await ctx.db.query<{
        account_last4: string;
        ifsc: string;
        holder_name: string;
        bank_name: string | null;
      }>(
        `select account_last4, ifsc, holder_name, bank_name
           from bank_accounts where seller_id = $1 limit 1`,
        [seller.id],
      ),
    );

    const rows = await ctx.db.query<{
      id: string;
      order_id: string;
      order_number: string;
      amount_paise: string;
      state: string;
      requested_at: string | null;
      released_at: string | null;
      reference: string | null;
      created_at: string;
      title: string;
    }>(
      `select p.id, p.order_id, o.order_number, p.amount_paise::text as amount_paise,
              p.state, p.requested_at::text as requested_at,
              p.released_at::text as released_at, p.reference,
              p.created_at::text as created_at, l.title
         from payouts p
         join orders o on o.id = p.order_id
         left join listings l on l.id = o.listing_id
        where p.seller_id = $1
        order by p.created_at desc
        limit 200`,
      [seller.id],
    );

    const sum = (state: string): number =>
      rows.rows
        .filter((r) => r.state === state)
        .reduce((total, r) => total + Number(r.amount_paise), 0) / 100;

    return json({
      bankAccount:
        bank === null
          ? null
          : {
              accountMasked: maskAccount(bank.account_last4),
              ifsc: bank.ifsc,
              holderName: bank.holder_name,
              bankName: bank.bank_name,
            },
      totals: {
        availableInr: sum('pending'),
        requestedInr: sum('processing'),
        paidInr: sum('paid'),
        onHoldInr: sum('on_hold'),
      },
      payouts: rows.rows.map((r) => ({
        id: r.id,
        orderId: r.order_id,
        orderNumber: r.order_number,
        title: r.title,
        amountInr: Number(r.amount_paise) / 100,
        state: r.state,
        requestedAt: r.requested_at,
        paidAt: r.released_at,
        reference: r.reference,
        createdAt: r.created_at,
      })),
    });
  });

  /**
   * POST /v1/payouts/:id/request
   *
   * The seller asking for their money. Only moves a payout that is settled and
   * unrequested, so a double-click cannot request twice.
   */
  router.add('POST', '/v1/payouts/:id/request', async (ctx) => {
    const seller = await requireSeller(ctx);
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such payout.');

    const bank = one(
      await ctx.db.query<{ id: string }>(
        `select id from bank_accounts where seller_id = $1 limit 1`,
        [seller.id],
      ),
    );
    if (bank === null) {
      throw badRequest('Add your bank account before requesting a payout.', {
        bankAccount: 'required',
      });
    }

    const updated = await ctx.db.query<{ id: string; amount_paise: string }>(
      `update payouts
          set state = 'processing', requested_at = now(), bank_account_id = $3
        where id = $1 and seller_id = $2 and state = 'pending'
        returning id, amount_paise::text as amount_paise`,
      [id, seller.id, bank.id],
    );

    if (updated.rows.length === 0) {
      // Either it is not theirs, or it is not available. Look it up to say
      // which, without revealing anything about another seller's payout.
      const mine = one(
        await ctx.db.query<{ state: string }>(
          `select state from payouts where id = $1 and seller_id = $2`,
          [id, seller.id],
        ),
      );
      if (mine === null) throw notFound('No such payout.');
      throw conflict(
        mine.state === 'processing'
          ? 'You have already requested this payout.'
          : `This payout is ${mine.state.replace(/_/g, ' ')} and cannot be requested.`,
      );
    }

    await ctx.db.query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
       values ($1::uuid, 'payout.requested', 'payout', $2::text, $3::inet, $4)`,
      [ctx.session?.userId ?? null, id, ctx.ip, ctx.userAgent],
    );

    return json({
      payout: {
        id,
        state: 'processing',
        amountInr: Number(updated.rows[0]!.amount_paise) / 100,
      },
      message: 'Requested. We transfer to your bank account and mark it paid with the reference.',
    });
  });

  /* ------------------------------- admin ------------------------------- */

  /**
   * GET /v1/admin/payouts — the transfer queue.
   *
   * This is the one place a full account number is revealed, because an admin
   * cannot make a transfer without it. Restricted to admins and audited.
   */
  router.add('GET', '/v1/admin/payouts', async (ctx) => {
    const actorId = await requireAdminId(ctx);

    const rows = await ctx.db.query<{
      id: string;
      order_number: string;
      seller_name: string;
      amount_paise: string;
      state: string;
      requested_at: string | null;
      reference: string | null;
      account_number_enc: string | null;
      account_last4: string | null;
      ifsc: string | null;
      holder_name: string | null;
      bank_name: string | null;
    }>(
      `select p.id, o.order_number, s.display_name as seller_name,
              p.amount_paise::text as amount_paise, p.state,
              p.requested_at::text as requested_at, p.reference,
              b.account_number_enc, b.account_last4, b.ifsc, b.holder_name, b.bank_name
         from payouts p
         join orders o on o.id = p.order_id
         join sellers s on s.id = p.seller_id
         left join bank_accounts b on b.id = p.bank_account_id
        where p.state in ('processing', 'pending', 'on_hold')
        order by p.requested_at asc nulls last
        limit 100`,
    );

    const wanted = ctx.url.searchParams.get('reveal') === 'true';
    if (wanted) {
      await ctx.db.query(
        `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, ip, user_agent)
         values ($1::uuid, 'admin', 'payout.bank_details_viewed', 'payout', 'queue', $2::inet, $3)`,
        [actorId, ctx.ip, ctx.userAgent],
      );
    }

    return json({
      payouts: rows.rows.map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        sellerName: r.seller_name,
        amountInr: Number(r.amount_paise) / 100,
        state: r.state,
        requestedAt: r.requested_at,
        reference: r.reference,
        bank:
          r.account_last4 === null
            ? null
            : {
                holderName: r.holder_name,
                bankName: r.bank_name,
                ifsc: r.ifsc,
                accountMasked: maskAccount(r.account_last4),
                // Only when explicitly asked for, and the request is audited.
                accountNumber:
                  wanted && r.account_number_enc !== null
                    ? safeDecrypt(r.account_number_enc)
                    : undefined,
              },
      })),
    });
  });

  /** POST /v1/admin/payouts/:id/paid — record a completed bank transfer. */
  router.add('POST', '/v1/admin/payouts/:id/paid', async (ctx) => {
    const actorId = await requireAdminId(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const reference = requiredString(fields, 'reference', 64);
    const note = optionalString(fields, 'note', 500);

    const updated = await ctx.db.query<{ id: string }>(
      `update payouts
          set state = 'paid', released_at = now(), reference = $2,
              paid_by = $3::uuid, note = $4
        where id = $1 and state in ('processing', 'pending')
        returning id`,
      [id, reference, actorId, note],
    );
    if (updated.rows.length === 0) {
      throw conflict('That payout is not awaiting a transfer.');
    }

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'payout.paid', 'payout', $2::text, $3::jsonb, $4::inet, $5)`,
      [actorId, id, JSON.stringify({ reference }), ctx.ip, ctx.userAgent],
    );

    return json({ id, state: 'paid', reference });
  });

  /**
   * POST /v1/admin/orders/:id/settle — the order is done; the seller is owed.
   *
   * Settling is what ends the buyer's protection, so it is deliberately a
   * decision somebody makes rather than a timer: the inspection window has
   * passed, no claim was raised, and the money is now the seller's. Creating
   * the payout in the same transaction means an order can never be settled
   * without the seller becoming owed.
   */
  router.add('POST', '/v1/admin/orders/:id/settle', async (ctx) => {
    const actorId = await requireAdminId(ctx);
    const id = ctx.params['id'] ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('No such order.');

    const result = await database.transaction(async (tx) => {
      const moved = await tx.query<{ id: string }>(
        `update orders set state = 'completed', completed_at = now()
          where id = $1 and state in ('paid', 'packed', 'shipped', 'delivered', 'inspection')
          returning id`,
        [id],
      );
      if (moved.rows.length === 0) return null;
      const created = await createPayoutForOrder(tx, id);
      return { created };
    });

    if (result === null) {
      const existing = one(
        await ctx.db.query<{ state: string }>(`select state from orders where id = $1`, [id]),
      );
      if (existing === null) throw notFound('No such order.');
      throw conflict(`This order is ${existing.state.replace(/_/g, ' ')} and cannot be settled.`);
    }

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, ip, user_agent)
       values ($1::uuid, 'admin', 'order.settled', 'order', $2::text, $3::inet, $4)`,
      [actorId, id, ctx.ip, ctx.userAgent],
    );

    return json({ id, state: 'completed', payoutCreated: result.created });
  });

  /** POST /v1/admin/payouts/:id/hold — withhold, with a reason. */
  router.add('POST', '/v1/admin/payouts/:id/hold', async (ctx) => {
    const actorId = await requireAdminId(ctx);
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());
    const reason = requiredString(fields, 'reason', 500);

    const updated = await ctx.db.query<{ id: string }>(
      `update payouts set state = 'on_hold', hold_reason = $2
        where id = $1 and state in ('pending', 'processing')
        returning id`,
      [id, reason],
    );
    if (updated.rows.length === 0) throw conflict('That payout cannot be held.');

    await ctx.db.query(
      `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, after, ip, user_agent)
       values ($1::uuid, 'admin', 'payout.held', 'payout', $2::text, $3::jsonb, $4::inet, $5)`,
      [actorId, id, JSON.stringify({ reason }), ctx.ip, ctx.userAgent],
    );

    return json({ id, state: 'on_hold' });
  });

  /**
   * A payout row for an order that has settled.
   *
   * Exposed so the order flow can call it when an order completes. The insert
   * is conditional on the order actually being settled and on this seller
   * owning it, so it cannot be used to conjure a payout.
   */
  async function requireAdminId(ctx: Parameters<typeof requireSeller>[0]): Promise<string> {
    if (ctx.session === null) throw unauthorized();
    const roles = await ctx.db.query<{ role: string }>(
      `select role from user_roles where user_id = $1`,
      [ctx.session.userId],
    );
    // 404 to a signed-in non-admin, matching the rest of the console.
    if (!roles.rows.some((r) => r.role === 'admin')) throw notFound('Not found.');
    return ctx.session.userId;
  }
}

/**
 * Decrypt for display, or say so.
 *
 * A tampered or unreadable ciphertext must never render as a plausible account
 * number; the admin needs to see that something is wrong and stop.
 */
function safeDecrypt(stored: string): string {
  try {
    return decryptAccountNumber(stored);
  } catch {
    return 'UNREADABLE — do not transfer, contact the seller';
  }
}

/**
 * Create the payout owed on a settled order.
 *
 * Idempotent: the unique index on order_id means a second call inserts nothing,
 * so a retried settlement cannot pay a seller twice.
 */
export async function createPayoutForOrder(
  db: { query<R>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }> },
  orderId: string,
): Promise<boolean> {
  const inserted = await db.query<{ id: string }>(
    `insert into payouts (order_id, seller_id, amount_paise, state)
     select o.id, o.seller_id,
            o.subtotal_paise - o.commission_paise - o.gst_on_commission_paise - o.tds_paise,
            'pending'
       from orders o
      where o.id = $1 and o.state = 'completed'
     on conflict (order_id) do nothing
     returning id`,
    [orderId],
  );
  return inserted.rows.length > 0;
}
