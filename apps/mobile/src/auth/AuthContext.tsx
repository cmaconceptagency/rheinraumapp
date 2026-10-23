import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from '../lib/secureStore';
import type { UserDto } from '@rheinraum/shared';
import { ApiError, NetworkError, request, setTokenProvider } from '../api/client';
import { readJson, removeKeys, writeJson } from '../lib/storage';

const REFRESH_KEY = 'rr.refreshToken';
const USER_KEY = 'rr.user';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: UserDto | null;
  login: (email: string, password: string) => Promise<void>;
  acceptInvite: (email: string, code: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

/**
 * Anmeldung: Access-Token nur im Arbeitsspeicher, Refresh-Token im SecureStore (iOS Keychain / Android Keystore).
 * Ohne Netz startet die App mit dem zuletzt angemeldeten Benutzer, damit Offline-Buchungen möglich bleiben.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<UserDto | null>(null);
  const access = useRef<string | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);

  const signOutLocal = useCallback(async () => {
    access.current = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await removeKeys([USER_KEY]);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const applyTokens = useCallback(async (t: TokenResponse) => {
    access.current = t.accessToken;
    await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken);
    await writeJson(USER_KEY, t.user);
    setUser(t.user);
    setStatus('signedIn');
  }, []);

  const refresh = useCallback((): Promise<boolean> => {
    if (!refreshing.current) {
      refreshing.current = (async () => {
        const token = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!token) return false;
        try {
          const t = await request<TokenResponse>('/api/auth/refresh', { body: { refreshToken: token }, auth: false });
          await applyTokens(t);
          return true;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) await signOutLocal();
          return false;
        }
      })().finally(() => {
        refreshing.current = null;
      });
    }
    return refreshing.current;
  }, [applyTokens, signOutLocal]);

  useEffect(() => {
    setTokenProvider({ getAccessToken: () => access.current, refresh });
    (async () => {
      const token = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!token) return setStatus('signedOut');
      const cached = await readJson<UserDto | null>(USER_KEY, null);
      if (cached) {
        setUser(cached);
        setStatus('signedIn');
      }
      const ok = await refresh();
      if (!ok && !cached) setStatus('signedOut');
    })();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login: async (email, password) => {
        const t = await request<TokenResponse>('/api/auth/login', { body: { email: email.trim(), password }, auth: false });
        await applyTokens(t);
      },
      acceptInvite: async (email, code, password) => {
        const t = await request<TokenResponse>('/api/auth/accept-invite', {
          body: { email: email.trim(), code: code.trim(), password },
          auth: false,
        });
        await applyTokens(t);
      },
      logout: async () => {
        const token = await SecureStore.getItemAsync(REFRESH_KEY);
        if (token) await request('/api/auth/logout', { body: { refreshToken: token }, auth: false }).catch(() => undefined);
        await signOutLocal();
      },
    }),
    [status, user, applyTokens, signOutLocal],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth außerhalb von AuthProvider');
  return v;
}

export { NetworkError };
