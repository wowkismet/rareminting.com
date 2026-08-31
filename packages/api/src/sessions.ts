/**
 * Session issue, lookup, rotation and revocation.
 *
 * The token handed to the client is 32 random bytes. Only its SHA-256 lands in
 * the database, so a leaked table does not let anyone sign in.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';
import { one } from './db.ts';

export const SESSION_TTL_DAYS = 30;

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface IssuedSession extends Session {
  /** Shown to the client exactly once; never recoverable afterwards. */
  readonly token: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compare two hex digests without leaking position through timing. */
export function tokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date | string;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

export interface IssueOptions {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly ttlDays?: number;
}

export async function issueSession(
  db: Db,
  userId: string,
  options: IssueOptions = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const ttl = options.ttlDays ?? SESSION_TTL_DAYS;

  const result = await db.query<SessionRow>(
    `insert into sessions (user_id, token_hash, expires_at, ip, user_agent)
     values ($1, $2, now() + ($3 || ' days')::interval, $4, $5)
     returning id, user_id, expires_at`,
    [userId, hashToken(token), String(ttl), options.ip ?? null, options.userAgent ?? null],
  );

  const row = result.rows[0];
  if (row === undefined) throw new Error('failed to create session');
  return { ...toSession(row), token };
}

/**
 * Resolve a bearer token to a live session.
 *
 * Returns null for anything not currently valid — unknown, expired, revoked, or
 * belonging to a user who is no longer active. The caller cannot tell which,
 * deliberately.
 */
export async function resolveSession(db: Db, token: string): Promise<Session | null> {
  if (token.length === 0) return null;

  const result = await db.query<SessionRow>(
    `select s.id, s.user_id, s.expires_at
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.status = 'active'`,
    [hashToken(token)],
  );

  const row = one(result);
  if (row === null) return null;

  await db.query(`update sessions set last_used_at = now() where id = $1`, [row.id]);
  return toSession(row);
}

export async function revokeSession(db: Db, sessionId: string, reason: string): Promise<void> {
  await db.query(
    `update sessions set revoked_at = now(), revoked_reason = $2
      where id = $1 and revoked_at is null`,
    [sessionId, reason],
  );
}

/** Used on password change and on suspicious activity. */
export async function revokeAllSessions(
  db: Db,
  userId: string,
  reason: string,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `update sessions set revoked_at = now(), revoked_reason = $2
      where user_id = $1 and revoked_at is null
      returning id`,
    [userId, reason],
  );
  return result.rows.length;
}
