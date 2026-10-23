/**
 * Persistente Offline-Warteschlange (ohne React-Native-Abhängigkeiten, damit sie testbar ist).
 *
 * - Einträge werden in Erfassungsreihenfolge verarbeitet.
 * - Jeder Eintrag trägt eine vom Gerät erzeugte clientId; der Server erkennt Wiederholungen,
 *   daher entstehen beim erneuten Senden nach Verbindungsabbrüchen keine Duplikate.
 * - Fachliche Ablehnungen (z. B. Überschneidung) werden als Konflikt abgelegt und nicht endlos wiederholt.
 */

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type TimeOpType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

export interface LocationPayload {
  lat: number;
  lng: number;
  accuracy: number;
  capturedAt: string;
}

export interface TimeOp {
  type: TimeOpType;
  clientId: string;
  deviceTime: string;
  siteId?: string;
  siteName?: string;
  location?: LocationPayload | null;
}

export type QueueItem =
  | { kind: 'time'; id: string; createdAt: string; attempts: number; op: TimeOp }
  | {
      kind: 'report';
      id: string;
      createdAt: string;
      attempts: number;
      report: { clientId: string; siteId: string; siteName?: string; reportDate: string; workDone: string; remarks: string | null };
    }
  | {
      kind: 'photo';
      id: string;
      createdAt: string;
      attempts: number;
      photo: { clientId: string; reportClientId: string; fileUri: string; mime: string };
    }
  | {
      kind: 'sick_note';
      id: string;
      createdAt: string;
      attempts: number;
      sickNote: { clientId: string; startDate: string; expectedEndDate: string; certificateProvided: boolean };
    }
  | {
      kind: 'correction';
      id: string;
      createdAt: string;
      attempts: number;
      request: { clientId: string; siteId: string; requestedStart: string; requestedEnd: string | null; reason: string };
    };

export type NewQueueItem = QueueItem extends infer T ? (T extends QueueItem ? Omit<T, 'id' | 'createdAt' | 'attempts'> : never) : never;

export interface Conflict {
  itemId: string;
  kind: QueueItem['kind'];
  summary: string;
  message: string;
  at: string;
}

/** Ergebnis eines Verarbeitungsversuchs je Eintrag. */
export type ItemOutcome = { status: 'done' } | { status: 'rejected'; message: string } | { status: 'retry'; message: string };

/** Verarbeitet einen Block von Einträgen (Zeitbuchungen werden gebündelt übertragen). */
export type BatchExecutor = (items: QueueItem[]) => Promise<ItemOutcome[]>;

const ITEMS_KEY = 'rr.queue.items';
const CONFLICTS_KEY = 'rr.queue.conflicts';

export class OfflineQueue {
  private items: QueueItem[] = [];
  private conflicts: Conflict[] = [];
  private loaded = false;
  private flushing: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private storage: KeyValueStorage,
    private newId: () => string,
    private now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.items = parse(await this.storage.getItem(ITEMS_KEY), []);
    this.conflicts = parse(await this.storage.getItem(CONFLICTS_KEY), []);
    this.loaded = true;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): readonly QueueItem[] {
    return this.items;
  }

  listConflicts(): readonly Conflict[] {
    return this.conflicts;
  }

  pendingTimeOps(): TimeOp[] {
    return this.items.flatMap((i) => (i.kind === 'time' ? [i.op] : []));
  }

  async enqueue(item: NewQueueItem): Promise<QueueItem> {
    await this.load();
    const full = { ...item, id: this.newId(), createdAt: this.now().toISOString(), attempts: 0 } as QueueItem;
    this.items = [...this.items, full];
    await this.persist();
    return full;
  }

  /** Entfernt alle Einträge (z. B. beim Abmelden nach ausdrücklicher Bestätigung). */
  async clear(): Promise<void> {
    this.items = [];
    this.conflicts = [];
    await this.persist();
  }

  async dismissConflict(itemId: string): Promise<void> {
    this.conflicts = this.conflicts.filter((c) => c.itemId !== itemId);
    await this.persist();
  }

  /**
   * Überträgt alle Einträge der Reihe nach. Bei einem "retry" (Netzwerk/Server nicht erreichbar)
   * wird abgebrochen, damit die Reihenfolge erhalten bleibt.
   */
  flush(execute: BatchExecutor): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.doFlush(execute).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async doFlush(execute: BatchExecutor): Promise<FlushResult> {
    await this.load();
    const result: FlushResult = { sent: 0, rejected: 0, stoppedWith: null };
    while (this.items.length > 0) {
      const batch = takeBatch(this.items);
      let outcomes: ItemOutcome[];
      try {
        outcomes = await execute(batch);
      } catch (err) {
        outcomes = batch.map(() => ({ status: 'retry', message: (err as Error).message }));
      }
      const handled = new Set<string>();
      let stop: string | null = null;
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const outcome = outcomes[i] ?? { status: 'retry', message: 'Keine Antwort' };
        if (outcome.status === 'retry') {
          stop = outcome.message;
          break;
        }
        handled.add(item.id);
        if (outcome.status === 'done') result.sent++;
        else {
          result.rejected++;
          this.conflicts = [
            ...this.conflicts,
            { itemId: item.id, kind: item.kind, summary: summarize(item), message: outcome.message, at: this.now().toISOString() },
          ];
        }
      }
      this.items = this.items
        .filter((i) => !handled.has(i.id))
        .map((i) => (stop && batch.some((b) => b.id === i.id) ? { ...i, attempts: i.attempts + 1 } : i));
      await this.persist();
      if (stop) {
        result.stoppedWith = stop;
        break;
      }
    }
    return result;
  }

  private async persist() {
    await this.storage.setItem(ITEMS_KEY, JSON.stringify(this.items));
    await this.storage.setItem(CONFLICTS_KEY, JSON.stringify(this.conflicts.slice(-50)));
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** Fehlertext, falls wegen fehlender Verbindung abgebrochen wurde. */
  stoppedWith: string | null;
}

/** Aufeinanderfolgende Zeitbuchungen werden gebündelt (max. 200), alles andere einzeln. */
export function takeBatch(items: QueueItem[]): QueueItem[] {
  if (items.length === 0) return [];
  if (items[0].kind !== 'time') return [items[0]];
  const batch: QueueItem[] = [];
  for (const i of items) {
    if (i.kind !== 'time' || batch.length >= 200) break;
    batch.push(i);
  }
  return batch;
}

const TIME_LABELS: Record<TimeOpType, string> = {
  clock_in: 'Arbeitsbeginn',
  break_start: 'Pause',
  break_end: 'Fortsetzen',
  clock_out: 'Arbeitsende',
};

export function summarize(item: QueueItem): string {
  const time = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  switch (item.kind) {
    case 'time':
      return `${TIME_LABELS[item.op.type]} ${time(item.op.deviceTime)}${item.op.siteName ? ` – ${item.op.siteName}` : ''}`;
    case 'report':
      return `Bericht ${item.report.reportDate}${item.report.siteName ? ` – ${item.report.siteName}` : ''}`;
    case 'photo':
      return 'Foto zu Bericht';
    case 'sick_note':
      return `Krankmeldung ab ${item.sickNote.startDate}`;
    case 'correction':
      return `Korrekturanfrage ${time(item.request.requestedStart)}`;
  }
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
