import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import {
  DEFAULT_MAX_ACCURACY_M,
  DEFAULT_MAX_LOCATION_AGE_S,
  ERROR_MESSAGES,
  evaluateLocation,
  type SiteDto,
  type WorkSessionDto,
} from '@rheinraum/shared';
import { ApiError, NetworkError, request } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { kv, readJson, removeKeys, writeJson } from '../lib/storage';
import { appendPhoto, deletePhoto, photoExists } from '../lib/photos';
import { OfflineQueue, type Conflict, type ItemOutcome, type LocationPayload, type NewQueueItem, type QueueItem, type TimeOp } from '../sync/queue';
import { applyPendingOps, fromServer, type LocalSession } from '../time/localSession';

export interface AssignedSite extends SiteDto {
  assignment: { validFrom: string; validTo: string | null };
  activeToday: boolean;
}

const SERVER_SESSION_KEY = 'rr.time.serverSession';
const SITES_KEY = 'rr.sites';

export type ActionResult =
  | { ok: true; offline: boolean }
  | { ok: false; code: string; message: string; details?: unknown };

interface AppData {
  online: boolean;
  session: LocalSession | null;
  sites: AssignedSite[];
  pendingCount: number;
  conflicts: readonly Conflict[];
  pendingItems: readonly QueueItem[];
  syncing: boolean;
  lastSyncError: string | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
  enqueue: (item: NewQueueItem) => Promise<void>;
  dismissConflict: (id: string) => Promise<void>;
  clockIn: (site: AssignedSite, fix: LocationPayload) => Promise<ActionResult>;
  pause: () => Promise<ActionResult>;
  resume: () => Promise<ActionResult>;
  clockOut: (fix: LocationPayload | null) => Promise<ActionResult>;
  clearLocalData: () => Promise<void>;
}

const Ctx = createContext<AppData | null>(null);

const queue = new OfflineQueue(kv, () => Crypto.randomUUID());

/** Überträgt einen Block der Warteschlange an die API. */
async function executeBatch(items: QueueItem[], onCurrent: (s: WorkSessionDto | null) => void): Promise<ItemOutcome[]> {
  const rejected = (err: unknown): ItemOutcome => {
    if (err instanceof ApiError && err.status !== 401) return { status: 'rejected', message: err.message };
    return { status: 'retry', message: (err as Error).message };
  };
  const first = items[0];
  if (first.kind === 'time') {
    try {
      const res = await request<{
        results: { clientId: string; status: 'applied' | 'duplicate' | 'rejected'; error?: { message: string } }[];
        current: WorkSessionDto | null;
      }>('/api/me/time/sync', {
        body: {
          ops: items.map((i) => {
            const { siteName: _omit, ...op } = (i as Extract<QueueItem, { kind: 'time' }>).op;
            return op;
          }),
        },
      });
      onCurrent(res.current);
      const byId = new Map(res.results.map((r) => [r.clientId, r]));
      return items.map((i) => {
        const r = byId.get((i as Extract<QueueItem, { kind: 'time' }>).op.clientId);
        if (!r) return { status: 'retry', message: 'Keine Antwort' };
        return r.status === 'rejected' ? { status: 'rejected', message: r.error?.message ?? 'Abgelehnt' } : { status: 'done' };
      });
    } catch (err) {
      return items.map(() => rejected(err));
    }
  }
  try {
    switch (first.kind) {
      case 'report':
        await request('/api/me/reports', { body: first.report });
        break;
      case 'sick_note':
        await request('/api/me/sick-notes', { body: first.sickNote });
        break;
      case 'correction':
        await request('/api/me/correction-requests', { body: first.request });
        break;
      case 'photo': {
        if (!photoExists(first.photo.fileUri)) return [{ status: 'rejected', message: 'Fotodatei nicht mehr vorhanden' }];
        const form = new FormData();
        // Textfelder vor der Datei (vom Server so erwartet).
        form.append('clientId', first.photo.clientId);
        form.append('reportClientId', first.photo.reportClientId);
        appendPhoto(form, first.photo.fileUri, first.photo.mime);
        await request('/api/me/photos', { form, timeoutMs: 60_000 });
        deletePhoto(first.photo.fileUri);
        break;
      }
    }
    return [{ status: 'done' }];
  } catch (err) {
    return [rejected(err)];
  }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [online, setOnline] = useState(true);
  const [serverSession, setServerSession] = useState<LocalSession | null>(null);
  const [sites, setSites] = useState<AssignedSite[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const onlineRef = useRef(true);

  const storeServerSession = useCallback(async (s: WorkSessionDto | null) => {
    const local = fromServer(s);
    setServerSession(local);
    await writeJson(SERVER_SESSION_KEY, local);
  }, []);

  // Persistierter Zustand: Timer und Warteschlange überstehen App-Schließen und Neustart.
  useEffect(() => {
    const unsub = queue.subscribe(() => setQueueVersion((v) => v + 1));
    queue.load();
    readJson<LocalSession | null>(SERVER_SESSION_KEY, null).then(setServerSession);
    readJson<AssignedSite[]>(SITES_KEY, []).then(setSites);
    return () => {
      unsub();
    };
  }, []);

  const syncNow = useCallback(async () => {
    if (status !== 'signedIn') return;
    setSyncing(true);
    try {
      const res = await queue.flush((items) => executeBatch(items, storeServerSession));
      setLastSyncError(res.stoppedWith);
    } finally {
      setSyncing(false);
    }
  }, [status, storeServerSession]);

  const refresh = useCallback(async () => {
    if (status !== 'signedIn') return;
    await syncNow();
    try {
      const [cur, s] = await Promise.all([
        request<{ session: WorkSessionDto | null }>('/api/me/time/current'),
        request<{ sites: AssignedSite[] }>('/api/me/sites'),
      ]);
      // Nur übernehmen, wenn keine Zeitbuchungen mehr ausstehen (sonst zeigt der Server einen älteren Stand).
      if (queue.pendingTimeOps().length === 0) await storeServerSession(cur.session);
      setSites(s.sites);
      await writeJson(SITES_KEY, s.sites);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
  }, [status, syncNow, storeServerSession]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      const isOnline = !!s.isConnected && s.isInternetReachable !== false;
      const cameOnline = isOnline && !onlineRef.current;
      onlineRef.current = isOnline;
      setOnline(isOnline);
      if (cameOnline) refresh().catch(() => undefined);
    });
    const appState = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh().catch(() => undefined);
    });
    return () => {
      unsub();
      appState.remove();
    };
  }, [refresh]);

  useEffect(() => {
    if (status === 'signedIn') refresh().catch(() => undefined);
  }, [status, refresh]);

  // Sicherheitsnetz: wartende Einträge regelmäßig erneut senden, falls ein Verbindungswechsel nicht gemeldet wurde.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const t = setInterval(() => {
      if (onlineRef.current && queue.list().length > 0) syncNow().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(t);
  }, [status, syncNow]);

  const pendingOps = useMemo(() => queue.pendingTimeOps(), [queueVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const session = useMemo(() => applyPendingOps(serverSession, pendingOps), [serverSession, pendingOps]);

  /**
   * Zeitbuchung: online direkt mit Serverzeit und Serverprüfung. Bei fehlender Verbindung (oder wenn bereits
   * Buchungen warten, um die Reihenfolge zu wahren) wird lokal mit Gerätezeit gespeichert und als ungeprüft
   * gekennzeichnet.
   */
  const timeAction = useCallback(
    async (op: TimeOp, path: string, body: Record<string, unknown>): Promise<ActionResult> => {
      const mustQueue = !onlineRef.current || queue.list().length > 0;
      if (!mustQueue) {
        try {
          const res = await request<{ session: WorkSessionDto }>(path, { body: { ...body, clientId: op.clientId, deviceTime: op.deviceTime } });
          await storeServerSession(res.session);
          return { ok: true, offline: false };
        } catch (err) {
          if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message, details: err.details };
          // Netzwerkfehler: dieselbe clientId wird später übertragen; der Server erkennt eine evtl. doch angekommene Buchung.
        }
      }
      await queue.enqueue({ kind: 'time', op });
      syncNow().catch(() => undefined);
      return { ok: true, offline: true };
    },
    [storeServerSession, syncNow],
  );

  const newOp = (type: TimeOp['type'], extra: Partial<TimeOp> = {}): TimeOp => ({
    type,
    clientId: Crypto.randomUUID(),
    deviceTime: new Date().toISOString(),
    ...extra,
  });

  const value = useMemo<AppData>(
    () => ({
      online,
      session,
      sites,
      pendingCount: queue.list().length,
      pendingItems: queue.list(),
      conflicts: queue.listConflicts(),
      syncing,
      lastSyncError,
      refresh,
      syncNow,
      enqueue: async (item) => {
        await queue.enqueue(item);
        syncNow().catch(() => undefined);
      },
      dismissConflict: (id) => queue.dismissConflict(id),
      clockIn: async (site, fix) => {
        if (session) return { ok: false, code: 'ALREADY_CLOCKED_IN', message: ERROR_MESSAGES.ALREADY_CLOCKED_IN };
        // Lokale Vorprüfung nur für schnelle Rückmeldung; maßgeblich ist die Prüfung im Backend.
        const local = evaluateLocation(fix, site, { radiusM: site.radiusM, maxAccuracyM: DEFAULT_MAX_ACCURACY_M, maxAgeS: DEFAULT_MAX_LOCATION_AGE_S }, new Date());
        if (!local.ok && !onlineRef.current) {
          return { ok: false, code: local.code, message: ERROR_MESSAGES[local.code as keyof typeof ERROR_MESSAGES], details: local };
        }
        const op = newOp('clock_in', { siteId: site.id, siteName: site.name, location: fix });
        return timeAction(op, '/api/me/time/clock-in', { siteId: site.id, location: fix });
      },
      pause: () => timeAction(newOp('break_start'), '/api/me/time/pause', {}),
      resume: () => timeAction(newOp('break_end'), '/api/me/time/resume', {}),
      clockOut: (fix) => timeAction(newOp('clock_out', { location: fix }), '/api/me/time/clock-out', { location: fix }),
      clearLocalData: async () => {
        await queue.clear();
        await removeKeys([SERVER_SESSION_KEY, SITES_KEY]);
        setServerSession(null);
        setSites([]);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [online, session, sites, syncing, lastSyncError, queueVersion, refresh, syncNow, timeAction],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData außerhalb von AppDataProvider');
  return v;
}
