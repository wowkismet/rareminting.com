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

/**
 * Send a one-time code to the seller's mobile.
 *
 * Reports rather than throws when OTP is not switched on, so the form can say
 * "carry on without it" instead of looking broken.
 */
export async function sendMobileOtp(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const mobile = text(data, 'mobile');
  if (mobile === '') return { error: 'Enter your mobile number first.' };

  const result = await api<{ sent: boolean; to?: string; message?: string }>('/v1/otp/mobile', {
    method: 'POST',
    token,
    body: { mobile },
  });

  if (!result.ok) return { error: result.error.message };
  if (!result.data.sent) {
    return { error: result.data.message ?? 'Mobile verification is not switched on yet.' };
  }
  return { error: null, notice: `Code sent to ${result.data.to ?? 'your mobile'}.` };
}

export async function registerSeller(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const fullName = text(data, 'fullName');
  const mobile = text(data, 'mobile');
  const pan = text(data, 'pan');
  const aadhaar = text(data, 'aadhaar');
  const otp = text(data, 'otp');

  // Caught here so the seller is not told to re-enter their Aadhaar over a
  // missing name. The API validates all of it again regardless.
  if (fullName === '') return { error: 'Enter your name as printed on your PAN card.' };
  if (mobile === '') return { error: 'Enter your mobile number.' };
  if (pan === '') return { error: 'Enter your PAN.' };
  if (aadhaar === '') return { error: 'Enter your Aadhaar number.' };

  const result = await api<{ seller: ApiSeller }>('/v1/sellers', {
    method: 'POST',
    token,
    body: { fullName, mobile, pan, aadhaar, ...(otp === '' ? {} : { otp }) },
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

/* ---------------- buying ---------------- */

export async function buyNow(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const listingId = text(data, 'listingId');
  if (listingId === '') return;

  const result = await api<{ order: { id: string } }>(`/v1/listings/${listingId}/order`, {
    method: 'POST',
    token,
  });

  if (!result.ok) {
    // The listing page shows the reason; nothing is half-created either way.
    redirect(`/listing/${listingId}?error=${encodeURIComponent(result.error.message)}`);
  }

  revalidatePath('/browse');
  redirect(`/orders/${result.data.order.id}`);
}

export async function makeOffer(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const listingId = text(data, 'listingId');
  const amountInr = Number(text(data, 'amountInr'));
  const message = text(data, 'message');

  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    return { error: 'Enter how much you would like to offer.', field: 'amountInr' };
  }

  const result = await api(`/v1/listings/${listingId}/offers`, {
    method: 'POST',
    token,
    body: { amountInr, ...(message === '' ? {} : { message }) },
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/listing/${listingId}`);
  redirect('/orders');
}

export async function respondToOffer(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const offerId = text(data, 'offerId');
  const decision = text(data, 'decision');
  if (offerId === '' || decision === '') return;

  await api(`/v1/offers/${offerId}/respond`, {
    method: 'POST',
    token,
    body: { decision },
  });
  revalidatePath('/orders');
}

/* ---------------- payouts ---------------- */

export async function saveBankAccount(_prev: FormState, data: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const holderName = text(data, 'holderName');
  const accountNumber = text(data, 'accountNumber');
  const ifsc = text(data, 'ifsc');
  const bankName = text(data, 'bankName');

  if (holderName === '') return { error: 'Enter the account holder name.' };
  if (accountNumber === '') return { error: 'Enter the account number.' };
  if (ifsc === '') return { error: 'Enter the IFSC.' };

  const result = await api('/v1/sellers/me/bank-account', {
    method: 'PUT',
    token,
    body: { holderName, accountNumber, ifsc, ...(bankName === '' ? {} : { bankName }) },
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/seller/payouts');
  return { error: null, notice: 'Bank account saved. Only the last four digits are kept visible.' };
}

export async function requestPayout(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const payoutId = text(data, 'payoutId');
  if (payoutId === '') return;

  await api(`/v1/payouts/${payoutId}/request`, { method: 'POST', token });
  revalidatePath('/seller/payouts');
}

/* ---------------- staff: payouts and settlement ---------------- */

export async function settleOrder(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const orderId = text(data, 'orderId');
  if (orderId === '') return;

  await api(`/v1/admin/orders/${orderId}/settle`, { method: 'POST', token });
  revalidatePath('/admin');
}

export async function markPayoutPaid(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const payoutId = text(data, 'payoutId');
  const reference = text(data, 'reference');
  if (payoutId === '' || reference === '') return;

  await api(`/v1/admin/payouts/${payoutId}/paid`, {
    method: 'POST',
    token,
    body: { reference },
  });
  revalidatePath('/admin/payouts');
}

export async function holdPayout(data: FormData): Promise<void> {
  const token = await sessionToken();
  if (token === null) redirect('/signin');

  const payoutId = text(data, 'payoutId');
  const reason = text(data, 'reason');
  if (payoutId === '' || reason === '') return;

  await api(`/v1/admin/payouts/${payoutId}/hold`, { method: 'POST', token, body: { reason } });
  revalidatePath('/admin/payouts');
}
