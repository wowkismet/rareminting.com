import { NextResponse } from 'next/server';

import { api } from '@/lib/api.ts';
import { sessionToken } from '@/lib/session.ts';

/**
 * Start a payment, on the buyer's behalf.
 *
 * This exists because the session token lives in an httpOnly cookie the browser
 * cannot read — deliberately, so a cross-site scripting bug cannot steal it.
 * The pay button therefore cannot call the API directly; it calls here, and
 * this attaches the token server-side.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ message: 'Sign in to pay for this order.' }, { status: 401 });
  }

  const result = await api<Record<string, unknown>>(`/v1/orders/${id}/payment`, {
    method: 'POST',
    token,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.error.message }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
