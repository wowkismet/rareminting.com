/**
 * The buyer's address book.
 *
 * A person keeps more than one — home and office, their own and the one they
 * are sending a gift to — so this is a list rather than a field on the user.
 * One of them is the default, enforced by a partial unique index rather than
 * by remembering to clear the old one.
 *
 * Addresses are only ever read by their owner. There is no route here that
 * takes a user id: whose addresses these are comes from the session, so a
 * changed id in a URL cannot reach somebody else's.
 */

import type { Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, notFound, unauthorized } from '../errors.ts';
import { asObject, optionalString, requiredString } from '../validate.ts';
import { one, type Database } from '../db.ts';

interface AddressRow {
  id: string;
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country_code: string;
  phone_e164: string | null;
  is_default: boolean;
}

function publicAddress(r: AddressRow): Record<string, unknown> {
  return {
    id: r.id,
    recipientName: r.recipient_name,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    countryCode: r.country_code,
    phone: r.phone_e164,
    isDefault: r.is_default,
  };
}

/** One address as a single block of text, for a label or an invoice. */
export function formatAddress(r: {
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
}): string {
  return [r.recipient_name, r.line1, r.line2, `${r.city}, ${r.state} ${r.postal_code}`]
    .filter((l): l is string => l !== null && l.trim() !== '')
    .join('\n');
}

/**
 * Validate the shape of an Indian postal address.
 *
 * The PIN check matches the database constraint rather than duplicating a
 * looser one here: six digits, not starting with zero. A wrong PIN is the
 * single most common reason a parcel comes back, so it is worth refusing at
 * the point somebody can still fix it.
 */
function readAddress(fields: Record<string, unknown>): {
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
} {
  const recipientName = requiredString(fields, 'recipientName', 120).trim();
  if (recipientName.length < 2) {
    throw badRequest('The parcel needs a name to be addressed to.', { recipientName: 'too_short' });
  }

  const line1 = requiredString(fields, 'line1', 200).trim();
  if (line1.length < 4) {
    throw badRequest('The first line of the address looks too short.', { line1: 'too_short' });
  }

  const city = requiredString(fields, 'city', 100).trim();
  const state = requiredString(fields, 'state', 100).trim();
  const postalCode = requiredString(fields, 'postalCode', 10).trim();

  if (!/^[1-9][0-9]{5}$/.test(postalCode)) {
    throw badRequest('An Indian PIN code is six digits and does not start with a zero.', {
      postalCode: 'invalid',
    });
  }

  const phoneRaw = optionalString(fields, 'phone', 20);
  let phone: string | null = null;
  if (phoneRaw !== null && phoneRaw.trim() !== '') {
    const digits = phoneRaw.replace(/[^0-9]/g, '');
    // Ten digits, or the same ten with a country code in front.
    const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
    if (!/^[6-9][0-9]{9}$/.test(local)) {
      throw badRequest('That does not look like an Indian mobile number.', { phone: 'invalid' });
    }
    phone = `+91${local}`;
  }

  return {
    recipientName,
    line1,
    line2: optionalString(fields, 'line2', 200),
    city,
    state,
    postalCode,
    phone,
  };
}

export function registerAddressRoutes(router: Router, database: Database): void {
  /** GET /v1/addresses — this person's address book, default first. */
  router.add('GET', '/v1/addresses', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const rows = await ctx.db.query<AddressRow>(
      `select id, recipient_name, line1, line2, city, state, postal_code,
              country_code, phone_e164, is_default
         from addresses
        where user_id = $1 and kind = 'shipping'
        order by is_default desc, created_at desc
        limit 50`,
      [ctx.session.userId],
    );

    return json({ addresses: rows.rows.map(publicAddress) });
  });

  /** POST /v1/addresses — add one. The first one added becomes the default. */
  router.add('POST', '/v1/addresses', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const fields = asObject(await ctx.body());
    const a = readAddress(fields);
    const asked = fields['isDefault'] === true;

    return database.transaction(async (tx) => {
      const existing = await tx.query<{ n: string }>(
        `select count(*)::text as n from addresses where user_id = $1 and kind = 'shipping'`,
        [userId],
      );
      // The first address a person adds is their default whether they asked or
      // not — there is nothing else for it to lose to.
      const wanted = asked || Number(existing.rows[0]?.n ?? '0') === 0;

      // Somebody who ticks "make this my default" expects exactly that, so the
      // old default is cleared inside the same transaction as the new one is
      // written. The unique index would otherwise reject the insert.
      if (wanted) {
        await tx.query(
          `update addresses set is_default = false
            where user_id = $1 and kind = 'shipping' and is_default`,
          [userId],
        );
      }

      const inserted = await tx.query<AddressRow>(
        `insert into addresses (user_id, kind, recipient_name, line1, line2,
                                city, state, postal_code, phone_e164, is_default)
         values ($1, 'shipping', $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, recipient_name, line1, line2, city, state, postal_code,
                   country_code, phone_e164, is_default`,
        [
          userId,
          a.recipientName,
          a.line1,
          a.line2,
          a.city,
          a.state,
          a.postalCode,
          a.phone,
          wanted,
        ],
      );

      return json({ address: publicAddress(inserted.rows[0]!) }, 201);
    });
  });

  /** PATCH /v1/addresses/:id — correct one, or make it the default. */
  router.add('PATCH', '/v1/addresses/:id', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const userId = ctx.session.userId;
    const id = ctx.params['id'] ?? '';
    const fields = asObject(await ctx.body());

    const owned = one(
      await ctx.db.query<{ id: string }>(
        `select id from addresses where id = $1 and user_id = $2`,
        [id, userId],
      ),
    );
    if (owned === null) throw notFound('No such address.');

    // "Make this the default" on its own, without re-typing the address.
    const onlyDefault = Object.keys(fields).length === 1 && fields['isDefault'] === true;

    return database.transaction(async (tx) => {
      if (onlyDefault || fields['isDefault'] === true) {
        await tx.query(
          `update addresses set is_default = false
            where user_id = $1 and kind = 'shipping' and is_default and id <> $2`,
          [userId, id],
        );
      }

      if (onlyDefault) {
        const row = await tx.query<AddressRow>(
          `update addresses set is_default = true, updated_at = now()
            where id = $1
            returning id, recipient_name, line1, line2, city, state, postal_code,
                      country_code, phone_e164, is_default`,
          [id],
        );
        return json({ address: publicAddress(row.rows[0]!) });
      }

      const a = readAddress(fields);
      const row = await tx.query<AddressRow>(
        `update addresses
            set recipient_name = $2, line1 = $3, line2 = $4, city = $5, state = $6,
                postal_code = $7, phone_e164 = $8,
                is_default = coalesce($9, is_default), updated_at = now()
          where id = $1
          returning id, recipient_name, line1, line2, city, state, postal_code,
                    country_code, phone_e164, is_default`,
        [
          id,
          a.recipientName,
          a.line1,
          a.line2,
          a.city,
          a.state,
          a.postalCode,
          a.phone,
          fields['isDefault'] === true ? true : null,
        ],
      );

      return json({ address: publicAddress(row.rows[0]!) });
    });
  });

  /**
   * DELETE /v1/addresses/:id — remove one from the book.
   *
   * Past orders are unaffected: they carry their own copy of the address they
   * were sent to, so removing it here cannot rewrite an invoice.
   */
  router.add('DELETE', '/v1/addresses/:id', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const removed = await ctx.db.query<{ id: string }>(
      `delete from addresses where id = $1 and user_id = $2 returning id`,
      [ctx.params['id'] ?? '', ctx.session.userId],
    );
    if (removed.rows.length === 0) throw notFound('No such address.');

    return json({ removed: removed.rows[0]!.id });
  });
}
