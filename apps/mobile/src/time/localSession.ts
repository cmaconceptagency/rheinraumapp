import type { BreakDto, Verification, WorkSessionDto } from '@rheinraum/shared';
import type { TimeOp } from '../sync/queue';

/** Anzeigezustand der laufenden Arbeitssitzung (Server-Stand + noch nicht synchronisierte Buchungen). */
export interface LocalSession {
  id: string | null;
  siteId: string;
  siteName: string;
  startedAt: string;
  breaks: BreakDto[];
  verification: Verification;
  /** true, wenn mindestens eine Buchung noch nicht vom Server bestätigt wurde. */
  pendingSync: boolean;
}

export function fromServer(s: WorkSessionDto | null): LocalSession | null {
  if (!s || s.endedAt) return null;
  return {
    id: s.id,
    siteId: s.siteId,
    siteName: s.siteName ?? '',
    startedAt: s.startedAt,
    breaks: s.breaks,
    verification: s.verification,
    pendingSync: false,
  };
}

/**
 * Wendet ausstehende (offline erfasste) Zeitbuchungen auf den letzten Server-Stand an.
 * Lokal erfasste Zeiten sind immer "ungeprüft" – es wird keine Serverprüfung vorgetäuscht.
 */
export function applyPendingOps(base: LocalSession | null, ops: TimeOp[]): LocalSession | null {
  let s = base ? { ...base, breaks: [...base.breaks] } : null;
  for (const op of ops) {
    switch (op.type) {
      case 'clock_in':
        if (!s) {
          s = {
            id: null,
            siteId: op.siteId ?? '',
            siteName: op.siteName ?? '',
            startedAt: op.deviceTime,
            breaks: [],
            verification: 'unverified',
            pendingSync: true,
          };
        }
        break;
      case 'break_start':
        if (s && !s.breaks.some((b) => !b.endedAt)) {
          s = { ...s, breaks: [...s.breaks, { id: op.clientId, startedAt: op.deviceTime, endedAt: null }], verification: 'unverified', pendingSync: true };
        }
        break;
      case 'break_end':
        if (s) {
          s = {
            ...s,
            breaks: s.breaks.map((b) => (b.endedAt ? b : { ...b, endedAt: op.deviceTime })),
            verification: 'unverified',
            pendingSync: true,
          };
        }
        break;
      case 'clock_out':
        s = null;
        break;
    }
  }
  return s;
}

export const isOnBreak = (s: LocalSession | null) => !!s?.breaks.some((b) => !b.endedAt);
