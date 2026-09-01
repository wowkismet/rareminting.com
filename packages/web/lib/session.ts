import 'server-only';

import { cookies } from 'next/headers';

import { api, type ApiSeller, type ApiUser } from './api.ts';

/**
 * The signed-in session, held in an httpOnly cookie.
 *
 * httpOnly so no script can read it, sameSite=lax so it is not sent on
 * cross-site POSTs, and secure in production so it never travels over plain
 * HTTP. The browser holds an opaque token; every lookup goes to the API.
 */

const COOKIE = 'rm_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

/** The signed-in user, or null. Never throws — a bad cookie reads as signed out. */
export async function currentUser(): Promise<ApiUser | null> {
  const token = await sessionToken();
  if (token === null) return null;

  const result = await api<{ user: ApiUser }>('/v1/auth/me', { token });
  return result.ok ? result.data.user : null;
}

/** The seller profile for the signed-in user, or null if they have not registered as one. */
export async function currentSeller(): Promise<ApiSeller | null> {
  const token = await sessionToken();
  if (token === null) return null;

  const result = await api<{ seller: ApiSeller }>('/v1/sellers/me', { token });
  return result.ok ? result.data.seller : null;
}
