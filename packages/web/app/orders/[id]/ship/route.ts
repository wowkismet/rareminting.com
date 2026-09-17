import { NextResponse } from 'next/server';

import { api } from '@/lib/api.ts';
import { sessionToken } from '@/lib/session.ts';

/**
 * Book the courier for one order.
 *
 * Exists for the same reason the payment start route does: the session token
 * lives in an httpOnly cookie the browser cannot read, deliberately, so a
 * cross-site scripting bug cannot steal it. The button therefore cannot call
 * the API directly — it calls here, and this attaches the token server-side.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const token = await sessionToken();
  if (token === null) {
    return NextResponse.json({ message: 'Sign in to book this parcel.' }, { status: 401 });
  }

  const result = await api<Record<string, unknown>>(`/v1/orders/${id}/ship`, {
    method: 'POST',
    token,
  });

  if (!result.ok) {
    return NextResponse.json({ message: result.error.message }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
