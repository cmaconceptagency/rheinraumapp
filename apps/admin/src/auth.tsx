import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserDto } from '@rheinraum/shared';
import { login as apiLogin, logout as apiLogout, refreshSession, setSignedOutHandler } from './api';

interface AuthCtx {
  user: UserDto | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    refreshSession()
      .then((s) => setUser(s?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        login: async (email, password) => {
          const s = await apiLogin(email, password);
          if (s.user.role === 'employee') {
            await apiLogout();
            throw new Error('Die Verwaltung ist nur für Bauleiter und Administratoren. Bitte die Mitarbeiter-App verwenden.');
          }
          setUser(s.user);
        },
        logout: async () => {
          await apiLogout();
          setUser(null);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth außerhalb von AuthProvider');
  return v;
}

/** Hilfen für die Oberfläche; maßgeblich sind die Prüfungen im Backend. */
export const can = (u: UserDto | null) => ({
  admin: u?.role === 'admin',
  hr: u?.role === 'admin' && u.hrAccess,
});
