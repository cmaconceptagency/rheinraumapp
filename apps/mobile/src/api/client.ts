import Constants from 'expo-constants';
import { ERROR_MESSAGES, type ErrorCode } from '@rheinraum/shared';

/**
 * API-Adresse: EXPO_PUBLIC_API_URL (z. B. in apps/mobile/.env) oder – in der Entwicklung –
 * automatisch der Rechner, auf dem der Expo-Server läuft (Port 4000).
 */
export function apiBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:4000` : 'http://localhost:4000';
}

/** Fachlicher Fehler der API (Server hat geantwortet). */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Server nicht erreichbar (kein Netz, Zeitüberschreitung, Server-Ausfall). */
export class NetworkError extends Error {}

type TokenProvider = {
  getAccessToken: () => string | null;
  refresh: () => Promise<boolean>;
};

let tokens: TokenProvider = { getAccessToken: () => null, refresh: async () => false };
export const setTokenProvider = (p: TokenProvider) => {
  tokens = p;
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  form?: FormData;
  auth?: boolean;
  timeoutMs?: number;
}

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = opts.auth === false ? null : tokens.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: controller.signal,
    });
  } catch (err) {
    throw new NetworkError((err as Error).name === 'AbortError' ? 'Zeitüberschreitung' : 'Keine Verbindung zum Server');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 && opts.auth !== false && !retried) {
    if (await tokens.refresh()) return request<T>(path, opts, true);
  }
  if (res.status >= 500 || res.status === 502 || res.status === 503) {
    throw new NetworkError(`Server nicht verfügbar (${res.status})`);
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (json as { error?: { code: ErrorCode; message: string; details?: unknown } } | null)?.error;
    const code = e?.code ?? 'INTERNAL';
    throw new ApiError(code, e?.message ?? ERROR_MESSAGES[code] ?? 'Fehler', res.status, e?.details);
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Unerwarteter Fehler.';
}

/** Header für geschützte Bild-Downloads (Fotos sind nur mit Anmeldung abrufbar). */
export function authHeaders(): Record<string, string> {
  const t = tokens.getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
