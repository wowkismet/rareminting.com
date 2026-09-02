import 'server-only';

/**
 * Server-side client for the Rare Minting API.
 *
 * Every call runs on the server, never in the browser. That matters: the
 * session token lives in an httpOnly cookie the browser cannot read, so a
 * cross-site scripting bug cannot walk off with someone's session.
 *
 * In production the web app and the API sit on the same machine, so this talks
 * to loopback and never leaves the box.
 */

const BASE = process.env['API_URL'] ?? 'http://127.0.0.1:4000';

export interface ApiError {
  readonly error: string;
  readonly message: string;
  readonly details?: Record<string, string>;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: ApiError };

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly token?: string | null;
  /** Seconds to cache. Omit for anything user-specific. */
  readonly revalidate?: number;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, token, revalidate } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token != null && token !== '') headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(revalidate === undefined ? { cache: 'no-store' } : { next: { revalidate } }),
    });
  } catch {
    // The API being down should read as a service problem, not a broken page.
    return {
      ok: false,
      status: 503,
      error: {
        error: 'unreachable',
        message: 'We could not reach the service. Please try again in a moment.',
      },
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const fallback: ApiError = {
      error: 'unexpected',
      message: 'Something went wrong. Please try again.',
    };
    return {
      ok: false,
      status: response.status,
      error: (parsed as ApiError | null) ?? fallback,
    };
  }

  return { ok: true, data: parsed as T };
}

/* ---------------- response shapes ---------------- */

export interface ApiUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
}

export interface ApiSeller {
  id: string;
  kind: string;
  displayName: string;
  kycState: string;
  mintingVerified: boolean;
  /** Approved by an admin, and so able to publish — without any cap. */
  approved: boolean;
}

export interface ApiListing {
  id: string;
  title: string;
  state: string;
  priceInr: number | null;
  grade: string | null;
  publishedAt: string | null;
  createdAt: string;
  note?: {
    denomination: number;
    series: string;
    prefix: string | null;
    isStar: boolean;
    serialDigits: string;
  };
  imageUrl?: string | null;
  media?: { id: string; kind: string; url: string }[];
  patterns?: { code: string; label: string; weight: number; detail: string | null }[];
  dates?: {
    iso: string | null;
    day: number;
    month: number;
    year: number | null;
    isPartial: boolean;
    confidence: number;
    era: string | null;
  }[];
  match?: {
    iso: string | null;
    day: number;
    month: number;
    year: number | null;
    confidence: number;
    era: string | null;
  };
}

export interface AuthResponse {
  user: ApiUser;
  token: string;
  expiresAt: string;
}
