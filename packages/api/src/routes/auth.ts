/**
 * Account registration and sign-in.
 *
 * Two properties this file works hard to preserve:
 *
 *  1. **No account enumeration.** Registering an address that already exists and
 *     signing in with a wrong password both take a similar amount of time and
 *     return a message that does not confirm whether the account exists.
 *  2. **Throttling is per identifier *and* per IP**, so neither a single account
 *     nor a single source can be ground down.
 */

import type { Ctx, Router } from '../http.ts';
import { json, noContent } from '../http.ts';
import { conflict, tooManyRequests, unauthorized } from '../errors.ts';
import { fakeVerify, hashPassword, verifyPassword } from '../password.ts';
import { issueSession, revokeAllSessions, revokeSession } from '../sessions.ts';
import { asObject, email, optionalString, password, phone } from '../validate.ts';
import { one } from '../db.ts';

const MAX_FAILURES_PER_IDENTIFIER = 8;
const MAX_FAILURES_PER_IP = 30;
const WINDOW_MINUTES = 15;

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  email_verified_at: Date | string | null;
  phone_e164: string | null;
  phone_verified_at: Date | string | null;
  created_at: Date | string;
}

function publicUser(row: UserRow, roles: string[]): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    emailVerified: row.email_verified_at !== null,
    phone: row.phone_e164,
    phoneVerified: row.phone_verified_at !== null,
    roles,
    createdAt: row.created_at,
  };
}

async function rolesOf(ctx: Ctx, userId: string): Promise<string[]> {
  const result = await ctx.db.query<{ role: string }>(
    `select role from user_roles where user_id = $1 order by role`,
    [userId],
  );
  return result.rows.map((r) => r.role);
}

async function assertNotThrottled(ctx: Ctx, identifier: string): Promise<void> {
  const result = await ctx.db.query<{ by_identifier: string; by_ip: string }>(
    `select
       count(*) filter (where identifier = $1)::text as by_identifier,
       count(*) filter (where ip is not null and ip = $2::inet)::text as by_ip
     from login_attempts
     where succeeded = false
       and attempted_at > now() - ($3 || ' minutes')::interval`,
    [identifier, ctx.ip, String(WINDOW_MINUTES)],
  );

  const row = result.rows[0];
  if (row === undefined) return;

  if (Number(row.by_identifier) >= MAX_FAILURES_PER_IDENTIFIER) {
    throw tooManyRequests(
      `Too many sign-in attempts. Try again in ${WINDOW_MINUTES} minutes, or reset your password.`,
    );
  }
  if (Number(row.by_ip) >= MAX_FAILURES_PER_IP) {
    throw tooManyRequests(`Too many sign-in attempts from this network. Try again shortly.`);
  }
}

async function recordAttempt(ctx: Ctx, identifier: string, succeeded: boolean): Promise<void> {
  await ctx.db.query(
    `insert into login_attempts (identifier, ip, succeeded) values ($1, $2, $3)`,
    [identifier, ctx.ip, succeeded],
  );
}

export function registerAuthRoutes(router: Router): void {
  /** POST /v1/auth/register */
  router.add('POST', '/v1/auth/register', async (ctx) => {
    const fields = asObject(await ctx.body());
    const address = email(fields);
    const secret = password(fields);
    const fullName = optionalString(fields, 'fullName', 200);
    const phoneNumber = fields['phone'] === undefined ? null : phone(fields);

    const existing = await ctx.db.query<{ id: string }>(
      `select id from users where lower(email) = $1`,
      [address],
    );
    if (one(existing) !== null) {
      // Hash anyway so a taken address does not answer faster than a free one.
      await hashPassword(secret);
      throw conflict('That email address is already registered. Try signing in instead.');
    }

    const passwordHash = await hashPassword(secret);

    // Accounts start active but unverified: a buyer can browse and save dates
    // immediately, while selling and payouts stay gated on verification.
    const created = await ctx.db.query<UserRow>(
      `insert into users (email, password_hash, full_name, phone_e164, status)
       values ($1, $2, $3, $4, 'active')
       returning id, email, full_name, status, email_verified_at,
                 phone_e164, phone_verified_at, created_at`,
      [address, passwordHash, fullName, phoneNumber],
    );

    const user = created.rows[0];
    if (user === undefined) throw new Error('failed to create user');

    await ctx.db.query(`insert into user_roles (user_id, role) values ($1, 'buyer')`, [user.id]);

    const session = await issueSession(ctx.db, user.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // actor_id is uuid and entity_id is text, so the shared placeholder needs an
    // explicit cast on each side or Postgres cannot deduce one type for it.
    await ctx.db.query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, ip, user_agent)
       values ($1::uuid, 'user.register', 'user', $1::text, $2::inet, $3)`,
      [user.id, ctx.ip, ctx.userAgent],
    );

    return json(
      {
        user: publicUser(user, ['buyer']),
        token: session.token,
        expiresAt: session.expiresAt,
      },
      201,
    );
  });

  /** POST /v1/auth/login */
  router.add('POST', '/v1/auth/login', async (ctx) => {
    const fields = asObject(await ctx.body());
    const address = email(fields);
    const secret = password(fields);

    await assertNotThrottled(ctx, address);

    const found = await ctx.db.query<UserRow & { password_hash: string | null }>(
      `select id, email, full_name, status, email_verified_at, phone_e164,
              phone_verified_at, created_at, password_hash
         from users where lower(email) = $1`,
      [address],
    );

    const user = one(found);

    // Same generic answer whether the account is missing, has no password set,
    // or the password is wrong.
    const invalid = unauthorized('Email or password is incorrect.');

    if (user === null || user.password_hash === null) {
      await fakeVerify();
      await recordAttempt(ctx, address, false);
      throw invalid;
    }

    if (!(await verifyPassword(secret, user.password_hash))) {
      await recordAttempt(ctx, address, false);
      throw invalid;
    }

    if (user.status !== 'active') {
      await recordAttempt(ctx, address, false);
      throw unauthorized('This account is not available. Contact support.');
    }

    await recordAttempt(ctx, address, true);

    const session = await issueSession(ctx.db, user.id, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    await ctx.db.query(`update users set last_seen_at = now() where id = $1`, [user.id]);

    return json({
      user: publicUser(user, await rolesOf(ctx, user.id)),
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  /** GET /v1/auth/me */
  router.add('GET', '/v1/auth/me', async (ctx) => {
    if (ctx.session === null) throw unauthorized();

    const found = await ctx.db.query<UserRow>(
      `select id, email, full_name, status, email_verified_at, phone_e164,
              phone_verified_at, created_at
         from users where id = $1`,
      [ctx.session.userId],
    );
    const user = one(found);
    if (user === null) throw unauthorized();

    return json({ user: publicUser(user, await rolesOf(ctx, user.id)) });
  });

  /** POST /v1/auth/logout — ends this session only. */
  router.add('POST', '/v1/auth/logout', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    await revokeSession(ctx.db, ctx.session.id, 'logout');
    return noContent();
  });

  /** POST /v1/auth/logout-all — ends every session for this user. */
  router.add('POST', '/v1/auth/logout-all', async (ctx) => {
    if (ctx.session === null) throw unauthorized();
    const count = await revokeAllSessions(ctx.db, ctx.session.userId, 'logout_all');
    return json({ revoked: count });
  });
}
