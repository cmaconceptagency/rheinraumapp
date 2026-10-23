import { useCallback, useEffect, useState } from 'react';
import type { SiteDto, UserDto } from '@rheinraum/shared';
import { api } from './api';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await run());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export type AdminSite = SiteDto & { managerIds: string[] };

/** Mitarbeiter- und Baustellenlisten für Filter und Auswahlfelder. */
export function useLookups() {
  const users = useLoad(() => api.get<{ users: UserDto[] }>('/api/admin/users?includeInactive=true').then((r) => r.users), []);
  const sites = useLoad(() => api.get<{ sites: AdminSite[] }>('/api/admin/sites?includeInactive=true').then((r) => r.sites), []);
  return { users: users.data ?? [], sites: sites.data ?? [], reloadUsers: users.reload, reloadSites: sites.reload };
}

export const fullName = (u: Pick<UserDto, 'firstName' | 'lastName'>) => `${u.firstName} ${u.lastName}`;
