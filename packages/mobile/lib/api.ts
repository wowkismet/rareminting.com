import * as SecureStore from 'expo-secure-store';

/**
 * The client for the API that already exists.
 *
 * Eighty-two endpoints are live at rareminting.com/api — marketplace, cart,
 * single-payment checkout, auctions, KYC, settlements, support. This app
 * consumes them rather than reimplementing any of it.
 *
 * The session token is kept in SecureStore, which is the Keychain on iOS and
 * the Keystore on Android. Not AsyncStorage: that is a plaintext file, readable
 * by anything with access to the device's storage and by any backup that
 * includes it. The web app keeps the same token in an httpOnly cookie the
 * browser cannot read — SecureStore is the nearest equivalent a native app has.
 */

const BASE = process.env['EXPO_PUBLIC_API_BASE'] ?? 'https://rareminting.com/api';

const TOKEN_KEY = 'rareminting.session';

export interface ApiUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  emailVerified: boolean;
  roles: string[];
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // A device with no secure hardware, or a keychain that refused. Treat as
    // signed out rather than crashing the app on launch.
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already gone.
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send the stored session token. Defaults to true. */
  auth?: boolean;
}

/**
 * One request.
 *
 * Never throws. A network failure and a 500 both come back as a result with a
 * message worth showing, because a marketplace used on a phone spends a good
 * deal of its life on a patchy connection and an unhandled rejection there is
 * a blank screen.
 */
export async function api<T>(path: string, options: Options = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';

  if (auth) {
    const token = await getToken();
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'No connection. Check your signal and try again.',
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
    const message =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : 'Something went wrong. Please try again.';

    // A rejected token is a signed-out session, not an error to show. Clearing
    // it here means the next screen sees the truth rather than retrying with a
    // token the server has already refused.
    if (response.status === 401) await clearToken();

    return { ok: false, status: response.status, message };
  }

  return { ok: true, data: parsed as T };
}

/* ------------------------------- shapes ------------------------------- */

export interface Listing {
  id: string;
  title: string;
  state: string;
  saleMode?: string;
  kind?: string;
  priceInr: number | null;
  grade: string | null;
  imageUrl: string | null;
  note?: {
    denomination: number;
    series: string;
    prefix: string | null;
    isStar: boolean;
    serialDigits: string;
  };
  match?: { iso: string | null; day: number; month: number };
}

/**
 * An image path from the API is site-relative. A phone has no origin to
 * resolve it against, so it is made absolute here rather than in each screen.
 */
export function imageUrl(path: string | null): string | null {
  if (path === null) return null;
  if (path.startsWith('http')) return path;
  return `${BASE.replace(/\/api$/, '')}${path}`;
}
