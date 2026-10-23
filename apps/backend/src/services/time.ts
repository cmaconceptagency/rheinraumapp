import type pg from 'pg';
import { evaluateLocation, haversineMeters, type LocationFix, type WorkSessionDto } from '@rheinraum/shared';
import { ApiError } from '../errors.js';
import { tx, type Db, type DbClient } from '../db/pool.js';
import type { AuthUser } from '../auth/plugin.js';
import { toBreak, toSession } from './mappers.js';

export interface LocationRulesConfig {
  maxAccuracyM: number;
  maxAgeS: number;
}

export interface TimeOpBase {
  /** Vom Gerät erzeugte UUID; dieselbe ID darf beliebig oft gesendet werden. */
  clientId: string;
  /** Gerätezeit der Aktion (ISO-8601). Bei Offline-Buchungen maßgeblich, sonst nur Information. */
  deviceTime?: string;
  /** true = Buchung wurde offline erfasst und wird nachträglich synchronisiert. */
  offline?: boolean;
}

export interface ClockInInput extends TimeOpBase {
  siteId: string;
  location?: LocationFix | null;
}

export interface ClockOutInput extends TimeOpBase {
  location?: LocationFix | null;
}

export interface TimeOpResult {
  session: WorkSessionDto;
  /** true, wenn die Buchung bereits vorher verarbeitet wurde (Wiederholung ohne Wirkung). */
  duplicate: boolean;
}

/** Erlaubte Abweichung der Geräteuhr, ab der für das Standortalter die Serverzeit genutzt wird. */
const MAX_CLOCK_SKEW_MS = 10 * 60_000;
/** Offline-Buchungen dürfen nicht in der Zukunft liegen (kleine Toleranz für Uhrabweichung). */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

const isUniqueViolation = (err: unknown, constraint?: string) =>
  (err as { code?: string }).code === '23505' &&
  (!constraint || (err as { constraint?: string }).constraint === constraint);

function bookingTime(op: TimeOpBase, serverNow: Date): Date {
  if (!op.offline) return serverNow;
  const t = op.deviceTime ? new Date(op.deviceTime) : null;
  if (!t || Number.isNaN(t.getTime())) throw new ApiError('VALIDATION', { field: 'deviceTime' });
  if (t.getTime() > serverNow.getTime() + FUTURE_TOLERANCE_MS) throw new ApiError('TIME_ORDER', { field: 'deviceTime' });
  return t;
}

export async function loadSession(db: DbClient, sessionId: string, now = new Date()): Promise<WorkSessionDto> {
  const { rows } = await db.query(
    `SELECT ws.*, u.first_name || ' ' || u.last_name AS user_name, s.name AS site_name,
            r.first_name || ' ' || r.last_name AS reviewed_by_name
       FROM work_sessions ws
       JOIN users u ON u.id = ws.user_id
       JOIN sites s ON s.id = ws.site_id
       LEFT JOIN users r ON r.id = ws.reviewed_by
      WHERE ws.id = $1`,
    [sessionId],
  );
  if (!rows[0]) throw new ApiError('NOT_FOUND');
  const breaks = await db.query('SELECT * FROM work_breaks WHERE session_id = $1 ORDER BY started_at', [sessionId]);
  return toSession(rows[0], breaks.rows.map(toBreak), now);
}

/** Lädt mehrere Sitzungen samt Pausen (für Listen). */
export async function loadSessions(db: DbClient, where: string, params: unknown[], limit = 500): Promise<WorkSessionDto[]> {
  const { rows } = await db.query(
    `SELECT ws.*, u.first_name || ' ' || u.last_name AS user_name, s.name AS site_name,
            r.first_name || ' ' || r.last_name AS reviewed_by_name
       FROM work_sessions ws
       JOIN users u ON u.id = ws.user_id
       JOIN sites s ON s.id = ws.site_id
       LEFT JOIN users r ON r.id = ws.reviewed_by
      WHERE ${where}
      ORDER BY ws.started_at DESC
      LIMIT ${Math.min(Math.max(1, limit), 5000)}`,
    params,
  );
  if (rows.length === 0) return [];
  const breaks = await db.query(
    'SELECT * FROM work_breaks WHERE session_id = ANY($1::uuid[]) ORDER BY started_at',
    [rows.map((r) => r.id)],
  );
  const bySession = new Map<string, ReturnType<typeof toBreak>[]>();
  for (const b of breaks.rows) {
    const list = bySession.get(b.session_id) ?? [];
    list.push(toBreak(b));
    bySession.set(b.session_id, list);
  }
  const now = new Date();
  return rows.map((r) => toSession(r, bySession.get(r.id) ?? [], now));
}

/** Prüft, ob der Mitarbeiter der Baustelle am Kalendertag von `at` (Firmenzeitzone) zugewiesen ist. */
export async function isAssigned(db: DbClient, user: AuthUser, siteId: string, at: Date): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM site_assignments sa
         JOIN companies c ON c.id = $4
        WHERE sa.user_id = $1 AND sa.site_id = $2
          AND sa.valid_from <= ($3::timestamptz AT TIME ZONE c.timezone)::date
          AND (sa.valid_to IS NULL OR sa.valid_to >= ($3::timestamptz AT TIME ZONE c.timezone)::date)
     ) AS ok`,
    [user.id, siteId, at.toISOString(), user.companyId],
  );
  return rows[0].ok;
}

async function lockOpenSession(client: pg.PoolClient, userId: string) {
  const { rows } = await client.query(
    'SELECT * FROM work_sessions WHERE user_id = $1 AND ended_at IS NULL FOR UPDATE',
    [userId],
  );
  return rows[0] ?? null;
}

export async function clockIn(
  db: Db,
  user: AuthUser,
  input: ClockInInput,
  rules: LocationRulesConfig,
): Promise<TimeOpResult> {
  const existing = await db.query('SELECT id, site_id FROM work_sessions WHERE user_id = $1 AND client_id = $2', [
    user.id,
    input.clientId,
  ]);
  if (existing.rows[0]) {
    if (existing.rows[0].site_id !== input.siteId) throw new ApiError('CLIENT_ID_CONFLICT');
    return { session: await loadSession(db, existing.rows[0].id), duplicate: true };
  }

  const serverNow = new Date();
  const startedAt = bookingTime(input, serverNow);

  const siteRes = await db.query('SELECT id, lat, lng, radius_m, active FROM sites WHERE id = $1 AND company_id = $2', [
    input.siteId,
    user.companyId,
  ]);
  const site = siteRes.rows[0];
  if (!site) throw new ApiError('NOT_FOUND');
  if (!site.active) throw new ApiError('SITE_INACTIVE');
  if (!(await isAssigned(db, user, site.id, startedAt))) throw new ApiError('NOT_ASSIGNED');

  // Standortalter wird gegen die Geräteuhr gemessen, sofern diese plausibel ist.
  let referenceNow = startedAt;
  let clockSkewS: number | null = null;
  if (input.deviceTime) {
    const device = new Date(input.deviceTime);
    if (!Number.isNaN(device.getTime())) {
      clockSkewS = Math.round((serverNow.getTime() - device.getTime()) / 1000);
      if (input.offline || Math.abs(serverNow.getTime() - device.getTime()) <= MAX_CLOCK_SKEW_MS) referenceNow = device;
    }
  }
  const check = evaluateLocation(
    input.location,
    { lat: site.lat, lng: site.lng },
    { radiusM: site.radius_m, maxAccuracyM: rules.maxAccuracyM, maxAgeS: rules.maxAgeS },
    referenceNow,
  );
  const checkRecord = { ...check, checkedAt: serverNow.toISOString(), clockSkewS, offline: !!input.offline };

  // Online: Einstempeln nur nach erfolgreicher Serverprüfung.
  // Offline: Buchung wird angenommen, aber als ungeprüft gekennzeichnet; das Prüfergebnis wird nur protokolliert.
  if (!input.offline && !check.ok) throw new ApiError(check.code as never, check);

  try {
    const id = await tx(db, async (client) => {
      const open = await lockOpenSession(client, user.id);
      if (open) throw new ApiError('ALREADY_CLOCKED_IN', { sessionId: open.id });
      if (input.offline) {
        // Nachträgliche Buchung darf nicht in eine bereits erfasste Sitzung fallen.
        const overlap = await client.query(
          'SELECT 1 FROM work_sessions WHERE user_id = $1 AND started_at <= $2 AND ended_at > $2',
          [user.id, startedAt],
        );
        if (overlap.rows[0]) throw new ApiError('ALREADY_CLOCKED_IN');
      }
      const loc = input.location;
      const ins = await client.query(
        `INSERT INTO work_sessions (company_id, user_id, site_id, client_id, started_at, device_started_at,
            verification, source, start_lat, start_lng, start_accuracy_m, start_location_at, start_check)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          user.companyId,
          user.id,
          site.id,
          input.clientId,
          startedAt,
          input.deviceTime ?? null,
          input.offline ? 'unverified' : 'verified',
          input.offline ? 'offline' : 'online',
          loc?.lat ?? null,
          loc?.lng ?? null,
          loc?.accuracy ?? null,
          loc?.capturedAt ?? null,
          checkRecord,
        ],
      );
      return ins.rows[0].id as string;
    });
    return { session: await loadSession(db, id), duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err, 'work_sessions_one_open')) throw new ApiError('ALREADY_CLOCKED_IN');
    if (isUniqueViolation(err, 'work_sessions_user_id_client_id_key')) return clockIn(db, user, input, rules);
    throw err;
  }
}

/** Markiert eine verifizierte Sitzung als ungeprüft, sobald Offline-Daten (Gerätezeit) einfließen. */
async function markUnverifiedIfOffline(client: pg.PoolClient, sessionId: string, offline?: boolean) {
  if (offline) {
    await client.query(
      `UPDATE work_sessions SET verification = 'unverified', updated_at = now()
        WHERE id = $1 AND verification = 'verified'`,
      [sessionId],
    );
  }
}

export async function startBreak(db: Db, user: AuthUser, input: TimeOpBase): Promise<TimeOpResult> {
  const dup = await db.query(
    `SELECT b.session_id FROM work_breaks b JOIN work_sessions ws ON ws.id = b.session_id
      WHERE ws.user_id = $1 AND b.client_id = $2`,
    [user.id, input.clientId],
  );
  if (dup.rows[0]) return { session: await loadSession(db, dup.rows[0].session_id), duplicate: true };

  const at = bookingTime(input, new Date());
  try {
    const sessionId = await tx(db, async (client) => {
      const open = await lockOpenSession(client, user.id);
      if (!open) throw new ApiError('NOT_CLOCKED_IN');
      if (at < open.started_at) throw new ApiError('TIME_ORDER');
      const openBreak = await client.query('SELECT 1 FROM work_breaks WHERE session_id = $1 AND ended_at IS NULL', [
        open.id,
      ]);
      if (openBreak.rows[0]) throw new ApiError('ALREADY_ON_BREAK');
      const last = await client.query('SELECT max(ended_at) AS t FROM work_breaks WHERE session_id = $1', [open.id]);
      if (last.rows[0].t && at < last.rows[0].t) throw new ApiError('TIME_ORDER');
      await client.query('INSERT INTO work_breaks (session_id, client_id, started_at) VALUES ($1, $2, $3)', [
        open.id,
        input.clientId,
        at,
      ]);
      await markUnverifiedIfOffline(client, open.id, input.offline);
      return open.id as string;
    });
    return { session: await loadSession(db, sessionId), duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err, 'work_breaks_one_open')) throw new ApiError('ALREADY_ON_BREAK');
    if (isUniqueViolation(err)) return startBreak(db, user, input);
    throw err;
  }
}

export async function endBreak(db: Db, user: AuthUser, input: TimeOpBase): Promise<TimeOpResult> {
  const dup = await db.query(
    `SELECT b.session_id FROM work_breaks b JOIN work_sessions ws ON ws.id = b.session_id
      WHERE ws.user_id = $1 AND b.end_client_id = $2`,
    [user.id, input.clientId],
  );
  if (dup.rows[0]) return { session: await loadSession(db, dup.rows[0].session_id), duplicate: true };

  const at = bookingTime(input, new Date());
  try {
    const sessionId = await tx(db, async (client) => {
      const open = await lockOpenSession(client, user.id);
      if (!open) throw new ApiError('NOT_CLOCKED_IN');
      const br = await client.query('SELECT * FROM work_breaks WHERE session_id = $1 AND ended_at IS NULL FOR UPDATE', [
        open.id,
      ]);
      if (!br.rows[0]) throw new ApiError('NOT_ON_BREAK');
      if (at < br.rows[0].started_at) throw new ApiError('TIME_ORDER');
      await client.query('UPDATE work_breaks SET ended_at = $1, end_client_id = $2 WHERE id = $3', [
        at,
        input.clientId,
        br.rows[0].id,
      ]);
      await markUnverifiedIfOffline(client, open.id, input.offline);
      return open.id as string;
    });
    return { session: await loadSession(db, sessionId), duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err)) return endBreak(db, user, input);
    throw err;
  }
}

/** Ausstempeln ist auch außerhalb des Radius erlaubt; ein übermittelter Standort wird nur protokolliert. */
export async function clockOut(db: Db, user: AuthUser, input: ClockOutInput): Promise<TimeOpResult> {
  const dup = await db.query('SELECT id FROM work_sessions WHERE user_id = $1 AND end_client_id = $2', [
    user.id,
    input.clientId,
  ]);
  if (dup.rows[0]) return { session: await loadSession(db, dup.rows[0].id), duplicate: true };

  const at = bookingTime(input, new Date());
  try {
    const sessionId = await tx(db, async (client) => {
      const open = await lockOpenSession(client, user.id);
      if (!open) throw new ApiError('NOT_CLOCKED_IN');
      if (at < open.started_at) throw new ApiError('TIME_ORDER');
      // Eine noch laufende Pause endet automatisch mit dem Arbeitsende.
      const br = await client.query('SELECT started_at FROM work_breaks WHERE session_id = $1 AND ended_at IS NULL', [
        open.id,
      ]);
      if (br.rows[0] && at < br.rows[0].started_at) throw new ApiError('TIME_ORDER');
      await client.query('UPDATE work_breaks SET ended_at = $1 WHERE session_id = $2 AND ended_at IS NULL', [
        at,
        open.id,
      ]);

      let endDistance: number | null = null;
      const loc = input.location;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        const site = await client.query('SELECT lat, lng FROM sites WHERE id = $1', [open.site_id]);
        endDistance = haversineMeters(loc, site.rows[0]);
      }
      await client.query(
        `UPDATE work_sessions SET ended_at = $1, end_client_id = $2, device_ended_at = $3,
            end_lat = $4, end_lng = $5, end_accuracy_m = $6, end_distance_m = $7, updated_at = now()
          WHERE id = $8`,
        [at, input.clientId, input.deviceTime ?? null, loc?.lat ?? null, loc?.lng ?? null, loc?.accuracy ?? null, endDistance, open.id],
      );
      await markUnverifiedIfOffline(client, open.id, input.offline);
      return open.id as string;
    });
    return { session: await loadSession(db, sessionId), duplicate: false };
  } catch (err) {
    if (isUniqueViolation(err, 'work_sessions_end_client')) return clockOut(db, user, input);
    throw err;
  }
}
