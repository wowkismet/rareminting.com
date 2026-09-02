import { NextResponse } from 'next/server';

import { api } from '@/lib/api.ts';
import { sessionToken } from '@/lib/session.ts';

/**
 * What the browser reports after Razorpay's checkout closes.
 *
 * Forwarded to the API, which verifies the signature. Note what this does not
 * do: it does not mark anything paid. The webhook does that. This only lets the
 * buyer be told something immediately.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ message: 'Sign in to continue.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Malformed request.' }, { status: 400 });
  }

  const result = await api<Record<string, unknown>>('/v1/payments/checkout-callback', {
    method: 'POST',
    token,
    body,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.error.message }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
