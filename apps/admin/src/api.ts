import { ERROR_MESSAGES, type ErrorCode, type UserDto } from '@rheinraum/shared';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | 'NETWORK',
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

// Access-Token nur im Arbeitsspeicher; das Refresh-Token liegt als httpOnly-Cookie beim Browser.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: () => void = () => undefined;

export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

export interface Session {
  accessToken: string;
  user: UserDto;
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Client', 'web');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  try {
    return await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError('NETWORK', 'Server nicht erreichbar.', 0);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error;
    const code = (e?.code ?? 'INTERNAL') as ErrorCode;
    const detailMsg = Array.isArray(e?.details) ? ` (${e.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join('; ')})` : '';
    throw new ApiError(code, (e?.message ?? ERROR_MESSAGES[code] ?? 'Fehler') + detailMsg, res.status, e?.details);
  }
  return json as T;
}

export async function refreshSession(): Promise<Session | null> {
  const res = await raw('/api/auth/refresh', { method: 'POST', body: '{}' });
  if (!res.ok) return null;
  const s = (await res.json()) as Session;
  accessToken = s.accessToken;
  return s;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) refreshing = refreshSession().then((s) => !!s).finally(() => (refreshing = null));
  return refreshing;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await tryRefresh()) res = await raw(path, init);
    else {
      accessToken = null;
      onSignedOut();
    }
  }
  return res;
}

export const api = {
  get: async <T>(path: string) => parse<T>(await call(path)),
  post: async <T>(path: string, body: unknown = {}) => parse<T>(await call(path, { method: 'POST', body: JSON.stringify(body) })),
  patch: async <T>(path: string, body: unknown) => parse<T>(await call(path, { method: 'PATCH', body: JSON.stringify(body) })),
  put: async <T>(path: string, body: unknown) => parse<T>(await call(path, { method: 'PUT', body: JSON.stringify(body) })),
  del: async <T>(path: string) => parse<T>(await call(path, { method: 'DELETE' })),
  /** Geschützte Datei (Foto, CSV) als Blob laden. */
  blob: async (path: string) => {
    const res = await call(path);
    if (!res.ok) await parse(res);
    return res.blob();
  },
};

export async function login(email: string, password: string): Promise<Session> {
  const s = await parse<Session>(await raw('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
  accessToken = s.accessToken;
  return s;
}

export async function logout(): Promise<void> {
  await raw('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
  accessToken = null;
}

export const qs = (params: Record<string, string | undefined | null | boolean>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
