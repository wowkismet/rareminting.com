'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { api, type ApiListing, type AuthResponse, type ApiSeller } from '@/lib/api.ts';
import { clearSessionCookie, sessionToken, setSessionCookie } from '@/lib/session.ts';
import type { FormState } from '@/lib/form-state.ts';

/**
 * Form handlers.
 *
 * These run on the server, so the session token is set into an httpOnly cookie
 * the browser never exposes to script, and the API is reached over loopback.
 *
 * Each returns `{ error }` on failure rather than throwing, so the form can
 * show the message the API produced — those are already written for humans.
 */


function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function signUp(_prev: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const password = text(data, 'password');
  const fullName = text(data, 'fullName');

  if (email === '' || password === '') {
    return { error: 'Enter your email address and a password.' };
  }

  const result = await api<AuthResponse>('/v1/auth/register', {
    method: 'POST',
    body: { email, password, ...(fullName === '' ? {} : { fullName }) },
  });

  if (!result.ok) {
    const field = result.error.details ? Object.keys(result.error.details)[0] : null;
    return { error: result.error.message, field: field ?? null };
  }

  await setSessionCookie(result.data.token);
  redirect('/account');
}

export async function signIn(_prev: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const password = text(data, 'password');

  if (email === '' || password === '') {
    return { error: 'Enter your email address and password.' };
  }

  const result = await api<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (!result.ok) return { error: result.error.message };

  await setSessionCookie(result.data.token);
  redirect('/account');
}

export async function signOut(): Promise<void> {
  const token = await sessionToken();
  if (token !== null) {
    // Revoke server-side too, so the token is dead even if the cookie survives.
    await api('/v1/auth/logout', { method: 'POST', token });
  }
  await clearSessionCookie();
  redirect('/');
}

export async function registerSeller(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const displayName = text(data, 'displayName');
  const kind = text(data, 'kind');
  const legalName = text(data, 'legalName');
  const gstin = text(data, 'gstin');

  if (displayName === '') return { error: 'Enter the name buyers will see.' };

  const result = await api<{ seller: ApiSeller }>('/v1/sellers', {
    method: 'POST',
    token,
    body: {
      kind: kind === '' ? 'individual' : kind,
      displayName,
      ...(legalName === '' ? {} : { legalName }),
      ...(gstin === '' ? {} : { gstin }),
    },
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/account');
  redirect('/sell');
}

export async function createListing(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const serial = text(data, 'serial');
  const series = text(data, 'series');
  const grade = text(data, 'grade');
  const denomination = Number(text(data, 'denomination'));
  const priceInr = Number(text(data, 'priceInr'));
  const description = text(data, 'description');

  if (serial === '') return { error: 'Enter the serial number from the note.', field: 'serial' };
  if (!Number.isFinite(denomination) || denomination <= 0) {
    return { error: 'Choose a denomination.', field: 'denomination' };
  }
  if (!Number.isFinite(priceInr) || priceInr <= 0) {
    return { error: 'Enter a price in rupees.', field: 'priceInr' };
  }

  const result = await api<{ listing: ApiListing }>('/v1/listings', {
    method: 'POST',
    token,
    body: {
      serial,
      denomination,
      series: series === '' ? 'Mahatma Gandhi New Series' : series,
      priceInr,
      ...(grade === '' ? {} : { grade }),
      ...(description === '' ? {} : { description }),
    },
  });

  if (!result.ok) {
    const field = result.error.details ? Object.keys(result.error.details)[0] : null;
    return { error: result.error.message, field: field ?? null };
  }

  revalidatePath('/account');
  redirect(`/listing/${result.data.listing.id}`);
}

export async function publishListing(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const id = text(data, 'id');
  if (id === '') return;

  await api(`/v1/listings/${id}/publish`, { method: 'POST', token });
  revalidatePath('/account');
  revalidatePath(`/listing/${id}`);
}

/* ---------------- staff ---------------- */

export async function setKycState(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const sellerId = text(data, 'sellerId');
  const kycState = text(data, 'kycState');
  const reason = text(data, 'reason');
  if (sellerId === '' || kycState === '') return;

  await api(`/v1/admin/sellers/${sellerId}/kyc`, {
    method: 'POST',
    token,
    body: { kycState, ...(reason === '' ? {} : { reason }) },
  });
  revalidatePath('/admin');
}

export async function moderateListing(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const listingId = text(data, 'listingId');
  const state = text(data, 'state');
  const reason = text(data, 'reason');
  if (listingId === '' || state === '') return;

  await api(`/v1/admin/listings/${listingId}/state`, {
    method: 'POST',
    token,
    body: { state, ...(reason === '' ? {} : { reason }) },
  });
  revalidatePath('/admin');
  revalidatePath(`/listing/${listingId}`);
}

export async function uploadPhoto(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const listingId = text(data, 'listingId');
  const file = data.get('file');
  if (listingId === '' || !(file instanceof File) || file.size === 0) return;

  // Forwarded as multipart, so the bytes stream through rather than being
  // buffered into JSON.
  const forward = new FormData();
  forward.set('file', file, file.name);
  forward.set('kind', text(data, 'kind') || 'obverse');

  await fetch(`${process.env['API_URL'] ?? 'http://127.0.0.1:4000'}/v1/listings/${listingId}/media`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: forward,
  }).catch(() => undefined);

  revalidatePath(`/listing/${listingId}`);
}
