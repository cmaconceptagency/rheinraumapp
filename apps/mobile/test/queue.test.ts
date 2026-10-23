import { describe, expect, it } from 'vitest';
import { OfflineQueue, takeBatch, type ItemOutcome, type KeyValueStorage, type QueueItem } from '../src/sync/queue';
import { applyPendingOps, fromServer } from '../src/time/localSession';

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  async getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

let n = 0;
const newId = () => `id-${++n}`;
const timeOp = (type: 'clock_in' | 'break_start' | 'break_end' | 'clock_out', minute: number) => ({
  kind: 'time' as const,
  op: { type, clientId: `c-${type}-${minute}`, deviceTime: `2026-05-04T07:${String(minute).padStart(2, '0')}:00.000Z`, siteId: 's1', siteName: 'Hafen' },
});

describe('OfflineQueue', () => {
  it('bleibt nach Neustart erhalten (persistiert)', async () => {
    const storage = new MemoryStorage();
    const q1 = new OfflineQueue(storage, newId);
    await q1.enqueue(timeOp('clock_in', 0));
    const q2 = new OfflineQueue(storage, newId);
    await q2.load();
    expect(q2.list()).toHaveLength(1);
    expect(q2.pendingTimeOps()[0].type).toBe('clock_in');
  });

  it('bündelt Zeitbuchungen und behält die Reihenfolge', async () => {
    const q = new OfflineQueue(new MemoryStorage(), newId);
    await q.enqueue(timeOp('clock_in', 0));
    await q.enqueue(timeOp('break_start', 10));
    await q.enqueue({ kind: 'report', report: { clientId: 'r1', siteId: 's1', reportDate: '2026-05-04', workDone: 'x', remarks: null } });
    await q.enqueue({ kind: 'photo', photo: { clientId: 'p1', reportClientId: 'r1', fileUri: 'file:///a.jpg', mime: 'image/jpeg' } });
    await q.enqueue(timeOp('break_end', 20));
    const batches: string[][] = [];
    const res = await q.flush(async (items) => {
      batches.push(items.map((i) => (i.kind === 'time' ? i.op.type : i.kind)));
      return items.map(() => ({ status: 'done' }));
    });
    expect(batches).toEqual([['clock_in', 'break_start'], ['report'], ['photo'], ['break_end']]);
    expect(res).toEqual({ sent: 5, rejected: 0, stoppedWith: null });
    expect(q.list()).toHaveLength(0);
  });

  it('bricht bei Verbindungsproblemen ab und sendet später dieselben clientIds erneut (keine Duplikate)', async () => {
    const q = new OfflineQueue(new MemoryStorage(), newId);
    await q.enqueue(timeOp('clock_in', 0));
    await q.enqueue({ kind: 'report', report: { clientId: 'r1', siteId: 's1', reportDate: '2026-05-04', workDone: 'x', remarks: null } });
    const sentClientIds: string[] = [];
    const offline = await q.flush(async (items) => {
      items.forEach((i) => i.kind === 'time' && sentClientIds.push(i.op.clientId));
      throw new Error('Network request failed');
    });
    expect(offline.stoppedWith).toMatch(/Network/);
    expect(q.list()).toHaveLength(2);
    expect(q.list()[0].attempts).toBe(1);
    expect(q.list()[1].attempts).toBe(0);

    // Server-seitige Idempotenz simulieren: bekannte clientIds werden nicht doppelt angelegt.
    const server = new Set<string>();
    let created = 0;
    const online = async (items: QueueItem[]): Promise<ItemOutcome[]> =>
      items.map((i) => {
        const id = i.kind === 'time' ? i.op.clientId : i.kind === 'report' ? i.report.clientId : i.id;
        if (!server.has(id)) {
          server.add(id);
          created++;
        }
        return { status: 'done' };
      });
    server.add(sentClientIds[0]); // erste Übertragung kam doch beim Server an
    created = 1;
    const res = await q.flush(online);
    expect(res.sent).toBe(2);
    expect(created).toBe(2);
    expect(q.list()).toHaveLength(0);
  });

  it('legt fachliche Ablehnungen als Konflikt ab und macht weiter', async () => {
    const q = new OfflineQueue(new MemoryStorage(), newId);
    await q.enqueue(timeOp('clock_in', 0));
    await q.enqueue(timeOp('clock_out', 30));
    const res = await q.flush(async (items) =>
      items.map((i, idx) => (idx === 0 ? { status: 'rejected', message: 'Sie sind dieser Baustelle heute nicht zugewiesen.' } : { status: 'done' })),
    );
    expect(res).toMatchObject({ sent: 1, rejected: 1 });
    expect(q.listConflicts()[0].summary).toMatch(/^Arbeitsbeginn/);
    expect(q.listConflicts()[0].message).toMatch(/nicht zugewiesen/);
    await q.dismissConflict(q.listConflicts()[0].itemId);
    expect(q.listConflicts()).toHaveLength(0);
  });

  it('führt gleichzeitige flush-Aufrufe nur einmal aus', async () => {
    const q = new OfflineQueue(new MemoryStorage(), newId);
    await q.enqueue(timeOp('clock_in', 0));
    let calls = 0;
    const exec = async (items: QueueItem[]) => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return items.map(() => ({ status: 'done' }) as const);
    };
    await Promise.all([q.flush(exec), q.flush(exec), q.flush(exec)]);
    expect(calls).toBe(1);
  });

  it('takeBatch begrenzt auf 200 Zeitbuchungen', () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ ...timeOp('clock_in', 0), id: `x${i}`, createdAt: '', attempts: 0 })) as QueueItem[];
    expect(takeBatch(items)).toHaveLength(200);
  });
});

describe('Timer-Zustand mit Offline-Buchungen', () => {
  it('überträgt Pausen und kennzeichnet lokal als ungeprüft', () => {
    const base = fromServer({
      id: 'w1', userId: 'u', siteId: 's1', siteName: 'Hafen', startedAt: '2026-05-04T06:00:00.000Z', endedAt: null,
      verification: 'verified', source: 'online', startLocation: null, endDistanceM: null, breaks: [],
      totals: { grossMs: 0, breakMs: 0, netMs: 0 }, breakHint: null, note: null, reviewedAt: null, reviewedByName: null,
    });
    expect(base?.verification).toBe('verified');
    const s = applyPendingOps(base, [timeOp('break_start', 10).op]);
    expect(s?.breaks).toHaveLength(1);
    expect(s?.verification).toBe('unverified');
    expect(s?.pendingSync).toBe(true);
    const resumed = applyPendingOps(s, [timeOp('break_end', 20).op]);
    expect(resumed?.breaks[0].endedAt).toBe('2026-05-04T07:20:00.000Z');
    expect(applyPendingOps(resumed, [timeOp('clock_out', 30).op])).toBeNull();
  });

  it('offline begonnene Sitzung startet zur Gerätezeit', () => {
    const s = applyPendingOps(null, [timeOp('clock_in', 5).op]);
    expect(s).toMatchObject({ id: null, startedAt: '2026-05-04T07:05:00.000Z', verification: 'unverified', siteName: 'Hafen' });
  });
});
