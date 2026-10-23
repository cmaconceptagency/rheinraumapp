/**
 * SIMULIERTER Demo-Server für die Browser-Vorschau der Mitarbeiter-App.
 *
 * Bildet die von der App genutzten Endpunkte des echten Backends mit Beispieldaten im Browser nach
 * (gleiche Fehlercodes, gleiche Standortprüfung aus @rheinraum/shared). Er ersetzt NICHT das Backend
 * und wird nur gebaut, wenn EXPO_PUBLIC_DEMO=1 gesetzt ist.
 */
import {
  breakHint,
  computeSessionTotals,
  DEFAULT_MAX_ACCURACY_M,
  DEFAULT_MAX_LOCATION_AGE_S,
  ERROR_MESSAGES,
  evaluateLocation,
  haversineMeters,
  type ErrorCode,
  type LocationFix,
} from '@rheinraum/shared';

const PASSWORD = 'Baustelle2026!';
const STORE_KEY = 'rr.demo.db.v1';

interface DUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'employee';
  home: { lat: number; lng: number } | null;
  invited?: boolean;
}
interface DSite {
  id: string;
  name: string;
  street: string;
  zip: string;
  city: string;
  lat: number;
  lng: number;
  radiusM: number;
  contactName: string;
  contactPhone: string;
  notes: string;
}
interface DBreak {
  id: string;
  clientId: string;
  endClientId: string | null;
  startedAt: string;
  endedAt: string | null;
}
interface DSession {
  id: string;
  userId: string;
  siteId: string;
  clientId: string;
  endClientId: string | null;
  startedAt: string;
  endedAt: string | null;
  verification: 'verified' | 'unverified' | 'corrected' | 'manual';
  source: 'online' | 'offline' | 'admin';
  startCheck: unknown;
  endDistanceM: number | null;
  breaks: DBreak[];
}
interface DReport {
  id: string;
  userId: string;
  siteId: string;
  clientId: string;
  reportDate: string;
  workDone: string;
  remarks: string | null;
  createdAt: string;
  photos: { id: string; clientId: string; url: string; mime: string; sizeBytes: number; createdAt: string }[];
}
export interface DemoDb {
  users: DUser[];
  sites: DSite[];
  assignments: { userId: string; siteId: string; validFrom: string; validTo: string | null }[];
  sessions: DSession[];
  reports: DReport[];
  sickNotes: { id: string; userId: string; clientId: string; startDate: string; expectedEndDate: string; certificateProvided: boolean; createdAt: string }[];
  requests: { id: string; userId: string; siteId: string; clientId: string; requestedStart: string; requestedEnd: string | null; reason: string; status: 'pending'; createdAt: string }[];
}

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const at = (day: Date, h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();

export function createSeed(): DemoDb {
  const today = new Date();
  const max: DUser = { id: 'u-max', email: 'max@musterbau.example', firstName: 'Max', lastName: 'Mustermann', role: 'employee', home: { lat: 51.012, lng: 6.895 } };
  const erika: DUser = { id: 'u-erika', email: 'erika@musterbau.example', firstName: 'Erika', lastName: 'Musterfrau', role: 'employee', home: { lat: 50.73, lng: 7.095 } };
  const nina: DUser = { id: 'u-nina', email: 'neu@musterbau.example', firstName: 'Nina', lastName: 'Neu', role: 'employee', home: null, invited: true };
  const sites: DSite[] = [
    { id: 's-hafen', name: 'Neubau Rheinauhafen', street: 'Hafenkante 12', zip: '50678', city: 'Köln', lat: 50.9265, lng: 6.9637, radiusM: 500, contactName: 'Frau Polier (Bauherrin)', contactPhone: '0221 111111', notes: 'Zufahrt über Tor 2. Beispielbaustelle.' },
    { id: 's-deutz', name: 'Altbausanierung Deutz', street: 'Beispielufer 3', zip: '50679', city: 'Köln', lat: 50.9375, lng: 6.975, radiusM: 500, contactName: 'Herr Hausverwalter', contactPhone: '0221 222222', notes: 'Beispielbaustelle.' },
    { id: 's-bonn', name: 'Dachsanierung Bonn', street: 'Musterallee 44', zip: '53111', city: 'Bonn', lat: 50.7374, lng: 7.0982, radiusM: 300, contactName: 'Familie Beispiel', contactPhone: '0228 333333', notes: 'Beispielbaustelle.' },
  ];
  const from = localDate(addDays(today, -30));
  const sessions: DSession[] = [];
  for (let d = 1; d <= 10; d++) {
    const day = addDays(today, -d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    sessions.push({
      id: uid(),
      userId: max.id,
      siteId: d % 2 ? 's-hafen' : 's-deutz',
      clientId: uid(),
      endClientId: null,
      startedAt: at(day, 7),
      endedAt: at(day, 16, 15),
      verification: 'verified',
      source: 'online',
      startCheck: { ok: true, code: 'OK', distanceM: 35, accuracyM: 12, ageS: 2, radiusM: 500 },
      endDistanceM: 40,
      breaks: [
        { id: uid(), clientId: uid(), endClientId: null, startedAt: at(day, 9), endedAt: at(day, 9, 15) },
        { id: uid(), clientId: uid(), endClientId: null, startedAt: at(day, 12), endedAt: at(day, 12, 30) },
      ],
    });
  }
  return {
    users: [max, erika, nina],
    sites,
    assignments: [
      { userId: max.id, siteId: 's-hafen', validFrom: from, validTo: null },
      { userId: max.id, siteId: 's-deutz', validFrom: from, validTo: null },
      { userId: erika.id, siteId: 's-bonn', validFrom: from, validTo: null },
      { userId: nina.id, siteId: 's-hafen', validFrom: from, validTo: null },
    ],
    sessions,
    reports: [
      {
        id: uid(),
        userId: max.id,
        siteId: 's-hafen',
        clientId: uid(),
        reportDate: localDate(addDays(today, -1)),
        workDone: 'Schalung Decke 2. OG gestellt, Bewehrung vorbereitet.',
        remarks: 'Material für Donnerstag nachbestellen.',
        createdAt: at(addDays(today, -1), 16),
        photos: [],
      },
    ],
    sickNotes: [],
    requests: [],
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    public details?: unknown,
  ) {
    super(ERROR_MESSAGES[code]);
  }
}
const err = (code: ErrorCode, status = 409, details?: unknown) => new HttpError(status, code, details);

export class DemoServer {
  db: DemoDb;
  private listeners = new Set<() => void>();

  constructor() {
    this.db = this.load() ?? createSeed();
  }

  private load(): DemoDb | null {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as DemoDb) : null;
    } catch {
      return null;
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.db));
    } catch {
      /* Demo funktioniert auch ohne Speicherung */
    }
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset() {
    this.db = createSeed();
    this.save();
  }

  /** Verschiebt die Baustellen eines Benutzers an einen anderen Ort (z. B. für Tests mit echtem GPS). */
  moveSitesTo(point: { lat: number; lng: number }) {
    this.db.sites = this.db.sites.map((s, i) => ({ ...s, lat: point.lat + i * 0.01, lng: point.lng }));
    this.save();
  }

  // ------------------------------------------------------------------ Helfer

  private user(headers: Headers): DUser {
    const token = (headers.get('authorization') ?? '').replace('Bearer ', '');
    const u = this.db.users.find((x) => `demo-${x.id}` === token);
    if (!u) throw err('UNAUTHORIZED', 401);
    return u;
  }

  private tokens(u: DUser) {
    return { accessToken: `demo-${u.id}`, refreshToken: `demo-refresh-${u.id}`, user: this.userDto(u) };
  }

  private userDto(u: DUser) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      hrAccess: false,
      active: true,
      phone: null,
      personnelNo: null,
      invitePending: !!u.invited,
      companyName: 'Musterbau GmbH (Demo)',
    };
  }

  private assigned(u: DUser, siteId: string, when: Date) {
    const d = localDate(when);
    return this.db.assignments.some((a) => a.userId === u.id && a.siteId === siteId && a.validFrom <= d && (!a.validTo || a.validTo >= d));
  }

  private sessionDto(s: DSession) {
    const totals = computeSessionTotals(s, s.breaks);
    const site = this.db.sites.find((x) => x.id === s.siteId);
    const u = this.db.users.find((x) => x.id === s.userId)!;
    return {
      id: s.id,
      userId: s.userId,
      userName: `${u.firstName} ${u.lastName}`,
      siteId: s.siteId,
      siteName: site?.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      verification: s.verification,
      source: s.source,
      startLocation: s.startCheck,
      endDistanceM: s.endDistanceM,
      breaks: s.breaks.map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt })),
      totals,
      breakHint: s.endedAt ? breakHint(totals) : null,
      note: null,
      reviewedAt: null,
      reviewedByName: null,
    };
  }

  private open(u: DUser) {
    return this.db.sessions.find((s) => s.userId === u.id && !s.endedAt) ?? null;
  }

  private bookingTime(offline: boolean, deviceTime?: string) {
    if (!offline) return new Date();
    const t = deviceTime ? new Date(deviceTime) : null;
    if (!t || Number.isNaN(t.getTime())) throw err('VALIDATION', 400);
    if (t.getTime() > Date.now() + 120_000) throw err('TIME_ORDER', 400);
    return t;
  }

  private markOffline(s: DSession, offline: boolean) {
    if (offline && s.verification === 'verified') s.verification = 'unverified';
  }

  // ------------------------------------------------------------------ Zeitbuchungen (wie Backend)

  private clockIn(u: DUser, b: { clientId: string; siteId: string; location?: LocationFix | null; deviceTime?: string }, offline: boolean) {
    const dup = this.db.sessions.find((s) => s.userId === u.id && s.clientId === b.clientId);
    if (dup) return { session: this.sessionDto(dup), duplicate: true };
    const startedAt = this.bookingTime(offline, b.deviceTime);
    const site = this.db.sites.find((s) => s.id === b.siteId);
    if (!site) throw err('NOT_FOUND', 404);
    if (!this.assigned(u, site.id, startedAt)) throw err('NOT_ASSIGNED');
    const check = evaluateLocation(
      b.location,
      site,
      { radiusM: site.radiusM, maxAccuracyM: DEFAULT_MAX_ACCURACY_M, maxAgeS: DEFAULT_MAX_LOCATION_AGE_S },
      b.deviceTime ? new Date(b.deviceTime) : new Date(),
    );
    if (!offline && !check.ok) throw err(check.code as ErrorCode, 409, check);
    if (this.open(u)) throw err('ALREADY_CLOCKED_IN');
    if (offline && this.db.sessions.some((s) => s.userId === u.id && s.startedAt <= startedAt.toISOString() && s.endedAt && s.endedAt > startedAt.toISOString())) {
      throw err('ALREADY_CLOCKED_IN');
    }
    const s: DSession = {
      id: uid(),
      userId: u.id,
      siteId: site.id,
      clientId: b.clientId,
      endClientId: null,
      startedAt: startedAt.toISOString(),
      endedAt: null,
      verification: offline ? 'unverified' : 'verified',
      source: offline ? 'offline' : 'online',
      startCheck: { ...check, offline },
      endDistanceM: null,
      breaks: [],
    };
    this.db.sessions.push(s);
    return { session: this.sessionDto(s), duplicate: false };
  }

  private breakStart(u: DUser, b: { clientId: string; deviceTime?: string }, offline: boolean) {
    const dup = this.db.sessions.find((s) => s.userId === u.id && s.breaks.some((x) => x.clientId === b.clientId));
    if (dup) return { session: this.sessionDto(dup), duplicate: true };
    const t = this.bookingTime(offline, b.deviceTime).toISOString();
    const s = this.open(u);
    if (!s) throw err('NOT_CLOCKED_IN');
    if (s.breaks.some((x) => !x.endedAt)) throw err('ALREADY_ON_BREAK');
    if (t < s.startedAt) throw err('TIME_ORDER', 400);
    s.breaks.push({ id: uid(), clientId: b.clientId, endClientId: null, startedAt: t, endedAt: null });
    this.markOffline(s, offline);
    return { session: this.sessionDto(s), duplicate: false };
  }

  private breakEnd(u: DUser, b: { clientId: string; deviceTime?: string }, offline: boolean) {
    const dup = this.db.sessions.find((s) => s.userId === u.id && s.breaks.some((x) => x.endClientId === b.clientId));
    if (dup) return { session: this.sessionDto(dup), duplicate: true };
    const t = this.bookingTime(offline, b.deviceTime).toISOString();
    const s = this.open(u);
    if (!s) throw err('NOT_CLOCKED_IN');
    const br = s.breaks.find((x) => !x.endedAt);
    if (!br) throw err('NOT_ON_BREAK');
    if (t < br.startedAt) throw err('TIME_ORDER', 400);
    br.endedAt = t;
    br.endClientId = b.clientId;
    this.markOffline(s, offline);
    return { session: this.sessionDto(s), duplicate: false };
  }

  private clockOut(u: DUser, b: { clientId: string; deviceTime?: string; location?: LocationFix | null }, offline: boolean) {
    const dup = this.db.sessions.find((s) => s.userId === u.id && s.endClientId === b.clientId);
    if (dup) return { session: this.sessionDto(dup), duplicate: true };
    const t = this.bookingTime(offline, b.deviceTime).toISOString();
    const s = this.open(u);
    if (!s) throw err('NOT_CLOCKED_IN');
    if (t < s.startedAt) throw err('TIME_ORDER', 400);
    for (const br of s.breaks) if (!br.endedAt) br.endedAt = t;
    s.endedAt = t;
    s.endClientId = b.clientId;
    const site = this.db.sites.find((x) => x.id === s.siteId)!;
    s.endDistanceM = b.location ? haversineMeters(b.location, site) : null;
    this.markOffline(s, offline);
    return { session: this.sessionDto(s), duplicate: false };
  }

  // ------------------------------------------------------------------ Router

  async handle(method: string, url: URL, headers: Headers, body: unknown): Promise<{ status: number; body: unknown }> {
    try {
      const result = await this.route(method, url, headers, body);
      this.save();
      return { status: 200, body: result };
    } catch (e) {
      if (e instanceof HttpError) {
        this.save();
        return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
      }
      return { status: 500, body: { error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL } } };
    }
  }

  private async route(method: string, url: URL, headers: Headers, body: unknown): Promise<unknown> {
    const path = url.pathname.replace(/^.*?\/api\//, '/api/');
    const b = (body ?? {}) as Record<string, unknown>;
    const key = `${method} ${path}`;

    if (key === 'POST /api/auth/login') {
      const u = this.db.users.find((x) => x.email.toLowerCase() === String(b.email ?? '').toLowerCase().trim());
      if (!u || u.invited || b.password !== PASSWORD) throw err('INVALID_CREDENTIALS', 401);
      return this.tokens(u);
    }
    if (key === 'POST /api/auth/refresh') {
      const u = this.db.users.find((x) => `demo-refresh-${x.id}` === b.refreshToken);
      if (!u) throw err('UNAUTHORIZED', 401);
      return this.tokens(u);
    }
    if (key === 'POST /api/auth/logout') return { ok: true };
    if (key === 'POST /api/auth/accept-invite') {
      const u = this.db.users.find((x) => x.email.toLowerCase() === String(b.email ?? '').toLowerCase().trim());
      if (!u || !u.invited || String(b.code ?? '').trim().toUpperCase() !== 'DEMO-2026-CODE') throw err('INVITE_INVALID', 400);
      if (String(b.password ?? '').length < 10) throw err('VALIDATION', 400, [{ path: 'password', message: 'Mindestens 10 Zeichen' }]);
      u.invited = false;
      return this.tokens(u);
    }

    const u = this.user(headers);
    const q = url.searchParams;

    if (key === 'GET /api/me') return { user: this.userDto(u), hasHomeAddress: !!u.home, serverTime: new Date().toISOString() };
    if (key === 'GET /api/me/sites') {
      const today = localDate(new Date());
      return {
        sites: this.db.assignments
          .filter((a) => a.userId === u.id && (!a.validTo || a.validTo >= today))
          .map((a) => {
            const s = this.db.sites.find((x) => x.id === a.siteId)!;
            return { ...s, active: true, assignment: { validFrom: a.validFrom, validTo: a.validTo }, activeToday: a.validFrom <= today };
          }),
      };
    }
    if (key === 'GET /api/me/time/current') {
      const s = this.open(u);
      return { session: s ? this.sessionDto(s) : null, serverTime: new Date().toISOString() };
    }
    const now = () => new Date().toISOString();
    if (key === 'POST /api/me/time/clock-in') return { ...this.clockIn(u, b as never, false), serverTime: now() };
    if (key === 'POST /api/me/time/pause') return { ...this.breakStart(u, b as never, false), serverTime: now() };
    if (key === 'POST /api/me/time/resume') return { ...this.breakEnd(u, b as never, false), serverTime: now() };
    if (key === 'POST /api/me/time/clock-out') return { ...this.clockOut(u, b as never, false), serverTime: now() };
    if (key === 'POST /api/me/time/sync') {
      const results = [];
      for (const op of (b.ops as { type: string; clientId: string }[]) ?? []) {
        try {
          const r =
            op.type === 'clock_in'
              ? this.clockIn(u, op as never, true)
              : op.type === 'break_start'
                ? this.breakStart(u, op as never, true)
                : op.type === 'break_end'
                  ? this.breakEnd(u, op as never, true)
                  : this.clockOut(u, op as never, true);
          results.push({ clientId: op.clientId, status: r.duplicate ? 'duplicate' : 'applied', session: r.session });
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          results.push({ clientId: op.clientId, status: 'rejected', error: { code: e.code, message: e.message } });
        }
      }
      const s = this.open(u);
      return { results, current: s ? this.sessionDto(s) : null, serverTime: now() };
    }
    if (key === 'GET /api/me/time/sessions') {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      return {
        sessions: this.db.sessions
          .filter((s) => s.userId === u.id && localDate(new Date(s.startedAt)) >= from && localDate(new Date(s.startedAt)) <= to)
          .sort((x, y) => y.startedAt.localeCompare(x.startedAt))
          .map((s) => this.sessionDto(s)),
      };
    }
    if (key === 'GET /api/me/reports') {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      return {
        reports: this.db.reports
          .filter((r) => r.userId === u.id && r.reportDate >= from && r.reportDate <= to)
          .sort((x, y) => y.reportDate.localeCompare(x.reportDate) || y.createdAt.localeCompare(x.createdAt))
          .map((r) => this.reportDto(r)),
      };
    }
    if (key === 'POST /api/me/reports') {
      const dup = this.db.reports.find((r) => r.userId === u.id && r.clientId === b.clientId);
      if (dup) return { report: this.reportDto(dup), duplicate: true };
      if (!this.assigned(u, String(b.siteId), new Date(`${b.reportDate}T12:00:00`))) throw err('NOT_ASSIGNED');
      const r: DReport = {
        id: uid(),
        userId: u.id,
        siteId: String(b.siteId),
        clientId: String(b.clientId),
        reportDate: String(b.reportDate),
        workDone: String(b.workDone),
        remarks: (b.remarks as string) || null,
        createdAt: now(),
        photos: [],
      };
      this.db.reports.push(r);
      return { report: this.reportDto(r), duplicate: false };
    }
    if (key === 'POST /api/me/photos') {
      const form = body as FormData;
      const clientId = String(form.get('clientId'));
      const reportClientId = String(form.get('reportClientId'));
      const file = form.get('file') as Blob | null;
      const report = this.db.reports.find((r) => r.userId === u.id && r.clientId === reportClientId);
      if (!report) throw err('NOT_FOUND', 404);
      const existing = report.photos.find((p) => p.clientId === clientId);
      if (existing) return { photo: { ...existing, reportId: report.id }, duplicate: true };
      if (!file || !/^image\//.test(file.type)) throw err('UPLOAD_INVALID', 400);
      const dataUrl = await shrinkImage(file);
      const photo = { id: uid(), clientId, url: dataUrl, mime: 'image/jpeg', sizeBytes: file.size, createdAt: now() };
      report.photos.push(photo);
      return { photo: { ...photo, reportId: report.id }, duplicate: false };
    }
    if (key === 'GET /api/me/sick-notes') return { sickNotes: this.db.sickNotes.filter((s) => s.userId === u.id) };
    if (key === 'POST /api/me/sick-notes') {
      if ('diagnosis' in b) throw err('VALIDATION', 400);
      if (String(b.expectedEndDate) < String(b.startDate)) throw err('TIME_ORDER', 400);
      const dup = this.db.sickNotes.find((s) => s.userId === u.id && s.clientId === b.clientId);
      if (dup) return { sickNote: dup, duplicate: true };
      const n = { id: uid(), userId: u.id, clientId: String(b.clientId), startDate: String(b.startDate), expectedEndDate: String(b.expectedEndDate), certificateProvided: !!b.certificateProvided, createdAt: now() };
      this.db.sickNotes.push(n);
      return { sickNote: n, duplicate: false };
    }
    if (key === 'GET /api/me/correction-requests') return { requests: this.db.requests.filter((r) => r.userId === u.id) };
    if (key === 'POST /api/me/correction-requests') {
      const dup = this.db.requests.find((r) => r.userId === u.id && r.clientId === b.clientId);
      if (dup) return { request: dup, duplicate: true };
      if (String(b.reason ?? '').trim().length < 10) throw err('VALIDATION', 400);
      if (!this.assigned(u, String(b.siteId), new Date(String(b.requestedStart)))) throw err('NOT_ASSIGNED');
      const r = { id: uid(), userId: u.id, siteId: String(b.siteId), clientId: String(b.clientId), requestedStart: String(b.requestedStart), requestedEnd: (b.requestedEnd as string) ?? null, reason: String(b.reason), status: 'pending' as const, createdAt: now() };
      this.db.requests.push(r);
      return { request: { ...r, sessionId: null, reviewNote: null }, duplicate: false };
    }
    const dist = path.match(/^\/api\/me\/sites\/([^/]+)\/distance$/);
    if (method === 'GET' && dist) {
      const site = this.db.sites.find((s) => s.id === dist[1]);
      if (!site || !this.db.assignments.some((a) => a.userId === u.id && a.siteId === site.id)) throw err('NOT_FOUND', 404);
      if (!u.home) throw err('HOME_ADDRESS_MISSING', 404);
      const distanceM = haversineMeters(u.home, site) * 1.3;
      return { distance: { siteId: site.id, distanceM, durationS: distanceM / (50 / 3.6), provider: 'simuliert (Luftlinie × 1,3)', simulated: true, oneWay: true } };
    }
    throw err('NOT_FOUND', 404);
  }

  private reportDto(r: DReport) {
    const site = this.db.sites.find((s) => s.id === r.siteId);
    return {
      id: r.id,
      userId: r.userId,
      siteId: r.siteId,
      siteName: site?.name,
      reportDate: r.reportDate,
      workDone: r.workDone,
      remarks: r.remarks,
      createdAt: r.createdAt,
      photos: r.photos.map((p) => ({ id: p.id, reportId: r.id, mime: p.mime, sizeBytes: p.sizeBytes, createdAt: p.createdAt, url: p.url })),
    };
  }
}

/** Verkleinert Fotos für die Demo-Ablage im Browser (localStorage ist klein). */
async function shrinkImage(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 480 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}
