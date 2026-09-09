import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, clearToken, getToken, setToken, type ApiUser } from './api.ts';

/**
 * Who is signed in, for the whole app.
 *
 * The token is restored from the Keychain on launch and immediately checked
 * against the server. A stored token is not proof of a live session — it may
 * have expired, or been revoked from another device — and an app that trusts
 * it without asking shows somebody a dashboard that fails on every request.
 */

interface Session {
  user: ApiUser | null;
  /** True until the stored token has been checked. */
  loading: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  register(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

interface AuthResponse {
  user: ApiUser;
  token: string;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const token = await getToken();
      if (token === null) {
        if (!cancelled) setLoading(false);
        return;
      }

      const result = await api<{ user: ApiUser }>('/v1/auth/me');
      if (cancelled) return;

      // api() already clears a token the server rejected, so there is nothing
      // to tidy up here on failure.
      setUser(result.ok ? result.data.user : null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(
    async (path: string, email: string, password: string): Promise<string | null> => {
      const result = await api<AuthResponse>(path, {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      if (!result.ok) return result.message;

      await setToken(result.data.token);
      setUser(result.data.user);
      return null;
    },
    [],
  );

  const value = useMemo<Session>(
    () => ({
      user,
      loading,
      signIn: (email, password) => authenticate('/v1/auth/login', email, password),
      register: (email, password) => authenticate('/v1/auth/register', email, password),
      async signOut() {
        // Tell the server first so the session is revoked everywhere, but drop
        // it locally regardless — somebody tapping sign out on a train with no
        // signal must still end up signed out.
        await api('/v1/auth/logout', { method: 'POST' });
        await clearToken();
        setUser(null);
      },
    }),
    [user, loading, authenticate],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
