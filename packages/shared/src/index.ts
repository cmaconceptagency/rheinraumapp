/**
 * Gemeinsame Typen und reine Funktionen für Backend, Mitarbeiter-App und Admin-Weboberfläche.
 *
 * Bewusst als eine einzige Datei ohne relative Importe gehalten, damit sie unverändert
 * von Node (ESM-Build), Vite und Metro (React Native, direkt aus dem Quelltext) gelesen werden kann.
 */

// ---------------------------------------------------------------------------
// Rollen und Konstanten
// ---------------------------------------------------------------------------

export const ROLES = ['employee', 'site_manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Mitarbeiter',
  site_manager: 'Bauleiter',
  admin: 'Administrator',
};

/** Standardradius einer Baustelle in Metern. */
export const DEFAULT_SITE_RADIUS_M = 500;
/** Standardwert: maximal zulässige Standortungenauigkeit (Meter) beim Einstempeln. */
export const DEFAULT_MAX_ACCURACY_M = 100;
/** Standardwert: maximales Alter eines Standorts (Sekunden) beim Einstempeln. */
export const DEFAULT_MAX_LOCATION_AGE_S = 120;

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Luftlinienentfernung zweier Koordinaten in Metern (Haversine-Formel). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Verschiebt eine Koordinate um `meters` Richtung Norden (für Tests und Beispieldaten). */
export function offsetNorth(point: LatLng, meters: number): LatLng {
  return { lat: point.lat + (meters / EARTH_RADIUS_M) * (180 / Math.PI), lng: point.lng };
}

// ---------------------------------------------------------------------------
// Standortprüfung
// ---------------------------------------------------------------------------

export interface LocationFix extends LatLng {
  /** Genauigkeit (Radius in Metern, 68 % Konfidenz laut Betriebssystem). */
  accuracy: number;
  /** Zeitpunkt der Standortermittlung laut Gerät (ISO-8601). */
  capturedAt: string;
}

export interface LocationRules {
  radiusM: number;
  maxAccuracyM: number;
  maxAgeS: number;
}

export type LocationCheckCode =
  | 'OK'
  | 'LOCATION_MISSING'
  | 'LOCATION_INVALID'
  | 'LOCATION_STALE'
  | 'LOCATION_INACCURATE'
  | 'OUTSIDE_RADIUS';

export interface LocationCheckResult {
  ok: boolean;
  code: LocationCheckCode;
  distanceM: number | null;
  accuracyM: number | null;
  ageS: number | null;
  radiusM: number;
}

/**
 * Prüft einen Standort gegen eine Baustelle.
 *
 * - Das Alter wird mit der Gerätezeit (`deviceNow`) verglichen, damit eine leicht falsch gehende
 *   Geräteuhr nicht jeden Standort als veraltet erscheinen lässt.
 * - Der Grenzfall ist inklusiv: Abstand == Radius gilt als innerhalb.
 * - Die Genauigkeit wird nicht zugunsten des Mitarbeiters auf den Abstand angerechnet.
 */
export function evaluateLocation(
  fix: LocationFix | null | undefined,
  site: LatLng,
  rules: LocationRules,
  deviceNow: Date,
): LocationCheckResult {
  const base = { radiusM: rules.radiusM };
  if (!fix) return { ok: false, code: 'LOCATION_MISSING', distanceM: null, accuracyM: null, ageS: null, ...base };

  const captured = Date.parse(fix.capturedAt);
  const valid =
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lng) &&
    Math.abs(fix.lat) <= 90 &&
    Math.abs(fix.lng) <= 180 &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    Number.isFinite(captured);
  if (!valid) return { ok: false, code: 'LOCATION_INVALID', distanceM: null, accuracyM: null, ageS: null, ...base };

  const distanceM = haversineMeters(fix, site);
  const ageS = (deviceNow.getTime() - captured) / 1000;
  const result = { distanceM, accuracyM: fix.accuracy, ageS, ...base };

  // Standort aus der "Zukunft" (mehr als 30 s) ist unplausibel und wird wie veraltet behandelt.
  if (ageS > rules.maxAgeS || ageS < -30) return { ok: false, code: 'LOCATION_STALE', ...result };
  if (fix.accuracy > rules.maxAccuracyM) return { ok: false, code: 'LOCATION_INACCURATE', ...result };
  // Vergleich auf Zentimeter gerundet, damit Gleitkommarauschen den inklusiven Grenzfall nicht kippt.
  if (Math.round(distanceM * 100) / 100 > rules.radiusM) return { ok: false, code: 'OUTSIDE_RADIUS', ...result };
  return { ok: true, code: 'OK', ...result };
}

// ---------------------------------------------------------------------------
// Arbeitszeit- und Pausenberechnung
// ---------------------------------------------------------------------------

export interface Interval {
  startedAt: string;
  endedAt: string | null;
}

export interface SessionTotals {
  grossMs: number;
  breakMs: number;
  netMs: number;
}

/**
 * Berechnet Brutto-, Pausen- und Nettozeit einer Arbeitssitzung.
 * Offene Sitzungen/Pausen werden bis `now` gerechnet. Pausen werden auf die Sitzung begrenzt
 * und überlappende Pausen nur einmal gezählt.
 */
export function computeSessionTotals(session: Interval, breaks: Interval[], now: Date = new Date()): SessionTotals {
  const start = Date.parse(session.startedAt);
  const end = session.endedAt ? Date.parse(session.endedAt) : now.getTime();
  const grossMs = Math.max(0, end - start);

  const clipped = breaks
    .map((b) => {
      const bs = Math.max(start, Date.parse(b.startedAt));
      const be = Math.min(end, b.endedAt ? Date.parse(b.endedAt) : end);
      return [bs, be] as const;
    })
    .filter(([bs, be]) => be > bs)
    .sort((x, y) => x[0] - y[0]);

  let breakMs = 0;
  let cursor = -Infinity;
  for (const [bs, be] of clipped) {
    const from = Math.max(bs, cursor);
    if (be > from) breakMs += be - from;
    cursor = Math.max(cursor, be);
  }
  return { grossMs, breakMs, netMs: grossMs - breakMs };
}

/**
 * Hinweis nach § 4 ArbZG: mehr als 6 Std. Arbeit → mind. 30 Min. Pause, mehr als 9 Std. → mind. 45 Min.
 * Liefert nur einen Hinweis; es wird nichts automatisch abgezogen.
 */
export function breakHint(totals: SessionTotals): string | null {
  const hours = totals.netMs / 3_600_000;
  const breakMin = totals.breakMs / 60_000;
  if (hours > 9 && breakMin < 45) return 'Mehr als 9 Std. Arbeitszeit: gesetzlich mind. 45 Min. Pause.';
  if (hours > 6 && breakMin < 30) return 'Mehr als 6 Std. Arbeitszeit: gesetzlich mind. 30 Min. Pause.';
  return null;
}

/** Formatiert Millisekunden als "H:MM". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Formatiert Millisekunden als "H:MM:SS" (für den laufenden Timer). */
export function formatClock(ms: number): string {
  const totalS = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Fehlercodes der API
// ---------------------------------------------------------------------------

export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Bitte erneut anmelden.',
  FORBIDDEN: 'Für diese Aktion fehlt die Berechtigung.',
  NOT_FOUND: 'Eintrag nicht gefunden.',
  VALIDATION: 'Eingaben unvollständig oder ungültig.',
  INVALID_CREDENTIALS: 'E-Mail oder Passwort ist falsch.',
  ACCOUNT_INACTIVE: 'Dieses Konto ist deaktiviert.',
  INVITE_INVALID: 'Der Einladungscode ist ungültig oder abgelaufen.',
  SEAT_LIMIT: 'Die Anzahl lizenzierter Mitarbeiter ist erreicht.',
  NOT_ASSIGNED: 'Sie sind dieser Baustelle heute nicht zugewiesen.',
  SITE_INACTIVE: 'Diese Baustelle ist deaktiviert.',
  ALREADY_CLOCKED_IN: 'Sie sind bereits eingestempelt.',
  NOT_CLOCKED_IN: 'Es läuft keine Arbeitssitzung.',
  ALREADY_ON_BREAK: 'Die Pause läuft bereits.',
  NOT_ON_BREAK: 'Es läuft keine Pause.',
  ON_BREAK: 'Bitte zuerst die Pause beenden.',
  CLIENT_ID_CONFLICT: 'Diese Buchung wurde bereits mit anderen Daten übermittelt.',
  TIME_ORDER: 'Die Zeitangaben sind nicht in der richtigen Reihenfolge.',
  LOCATION_MISSING: 'Kein Standort übermittelt. Bitte Standortfreigabe erteilen und erneut prüfen.',
  LOCATION_INVALID: 'Der übermittelte Standort ist ungültig.',
  LOCATION_STALE: 'Der Standort ist veraltet. Bitte erneut prüfen.',
  LOCATION_INACCURATE: 'Der Standort ist zu ungenau. Bitte unter freiem Himmel erneut prüfen.',
  OUTSIDE_RADIUS: 'Sie befinden sich außerhalb des Baustellenradius.',
  UPLOAD_INVALID: 'Die Datei ist kein gültiges Foto (JPEG, PNG, WebP oder HEIC).',
  UPLOAD_TOO_LARGE: 'Das Foto ist zu groß.',
  HOME_ADDRESS_MISSING: 'Für Sie ist kein Wohnort hinterlegt.',
  ROUTING_FAILED: 'Die Entfernung konnte nicht berechnet werden.',
  RATE_LIMITED: 'Zu viele Versuche. Bitte kurz warten.',
  INTERNAL: 'Unerwarteter Fehler. Bitte später erneut versuchen.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// DTOs (Antworten der API)
// ---------------------------------------------------------------------------

export type Verification = 'verified' | 'unverified' | 'corrected' | 'manual';

export const VERIFICATION_LABELS: Record<Verification, string> = {
  verified: 'Serverbestätigt',
  unverified: 'Ungeprüft (offline)',
  corrected: 'Korrigiert',
  manual: 'Manuell erfasst',
};

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  hrAccess: boolean;
  active: boolean;
  phone: string | null;
  personnelNo: string | null;
  invitePending: boolean;
  companyName?: string;
}

export interface SiteDto {
  id: string;
  name: string;
  street: string;
  zip: string;
  city: string;
  lat: number;
  lng: number;
  radiusM: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  active: boolean;
}

export interface AssignmentDto {
  id: string;
  siteId: string;
  userId: string;
  validFrom: string;
  validTo: string | null;
  siteName?: string;
  userName?: string;
}

export interface BreakDto {
  id: string;
  startedAt: string;
  endedAt: string | null;
}

export interface WorkSessionDto {
  id: string;
  userId: string;
  userName?: string;
  siteId: string;
  siteName?: string;
  startedAt: string;
  endedAt: string | null;
  verification: Verification;
  source: 'online' | 'offline' | 'admin';
  startLocation: LocationCheckResult | null;
  endDistanceM: number | null;
  breaks: BreakDto[];
  totals: SessionTotals;
  breakHint: string | null;
  note: string | null;
  /** Gesetzt, wenn ein Admin/Bauleiter eine ungeprüfte Buchung kontrolliert hat (Kennzeichnung bleibt). */
  reviewedAt: string | null;
  reviewedByName: string | null;
}

export interface CorrectionDto {
  id: string;
  sessionId: string;
  changedBy: string;
  changedByName: string;
  reason: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionRequestDto {
  id: string;
  userId: string;
  userName?: string;
  siteId: string;
  siteName?: string;
  sessionId: string | null;
  requestedStart: string;
  requestedEnd: string | null;
  reason: string;
  status: CorrectionRequestStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface ReportDto {
  id: string;
  userId: string;
  userName?: string;
  siteId: string;
  siteName?: string;
  reportDate: string;
  workDone: string;
  remarks: string | null;
  photos: PhotoDto[];
  createdAt: string;
}

export interface PhotoDto {
  id: string;
  reportId: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
  /** Geschützter API-Pfad (erfordert Anmeldung). */
  url: string;
}

export interface SickNoteDto {
  id: string;
  userId: string;
  userName?: string;
  startDate: string;
  expectedEndDate: string;
  certificateProvided: boolean;
  createdAt: string;
}

export interface DistanceDto {
  siteId: string;
  distanceM: number;
  durationS: number | null;
  provider: string;
  simulated: boolean;
  /** Immer `true`: angegeben ist die einfache Strecke Wohnort → Baustelle. */
  oneWay: true;
}
