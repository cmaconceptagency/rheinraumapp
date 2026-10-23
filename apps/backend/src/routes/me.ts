import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DistanceDto } from '@rheinraum/shared';
import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';
import { sha256 } from '../auth/crypto.js';
import { toCorrectionRequest, toPhoto, toReport, toSickNote, toSite, toUser } from '../services/mappers.js';
import { clockIn, clockOut, endBreak, isAssigned, loadSessions, startBreak, type TimeOpResult } from '../services/time.js';
import { detectImage } from '../services/storage.js';

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000),
  capturedAt: z.string().datetime({ offset: true }),
});

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const opBase = { clientId: z.string().uuid(), deviceTime: isoDateTime.optional() };

const clockInSchema = z.object({ ...opBase, siteId: z.string().uuid(), location: locationSchema.nullable().optional() });
const clockOutSchema = z.object({ ...opBase, location: locationSchema.nullable().optional() });
const simpleOpSchema = z.object(opBase);

const syncOpSchema = z.discriminatedUnion('type', [
  clockInSchema.extend({ type: z.literal('clock_in'), deviceTime: isoDateTime }),
  simpleOpSchema.extend({ type: z.literal('break_start'), deviceTime: isoDateTime }),
  simpleOpSchema.extend({ type: z.literal('break_end'), deviceTime: isoDateTime }),
  clockOutSchema.extend({ type: z.literal('clock_out'), deviceTime: isoDateTime }),
]);

export async function meRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config } = deps;
  const rules = { maxAccuracyM: config.LOCATION_MAX_ACCURACY_M, maxAgeS: config.LOCATION_MAX_AGE_S };
  app.addHook('preHandler', deps.authenticate);

  const respond = (r: TimeOpResult) => ({ ...r, serverTime: new Date().toISOString() });

  app.get('/', async (req) => {
    const { rows } = await db.query(
      `SELECT u.*, c.name AS company_name, EXISTS (SELECT 1 FROM employee_home h WHERE h.user_id = u.id) AS has_home
         FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
      [req.auth.id],
    );
    return { user: toUser(rows[0]), hasHomeAddress: rows[0].has_home, serverTime: new Date().toISOString() };
  });

  /** Eigene Wohnadresse (nur für die Person selbst bzw. HR-berechtigte Admins sichtbar). */
  app.get('/home', async (req) => {
    const { rows } = await db.query('SELECT street, zip, city FROM employee_home WHERE user_id = $1', [req.auth.id]);
    return { home: rows[0] ?? null };
  });

  /** Zugewiesene Baustellen: heute gültig oder zukünftig. */
  app.get('/sites', async (req) => {
    const { rows } = await db.query(
      `SELECT s.*, sa.valid_from, sa.valid_to,
              (sa.valid_from <= today.d AND (sa.valid_to IS NULL OR sa.valid_to >= today.d)) AS active_today
         FROM site_assignments sa
         JOIN sites s ON s.id = sa.site_id
         JOIN companies c ON c.id = s.company_id
         CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE c.timezone)::date AS d) today
        WHERE sa.user_id = $1 AND s.active AND (sa.valid_to IS NULL OR sa.valid_to >= today.d)
        ORDER BY active_today DESC, sa.valid_from, s.name`,
      [req.auth.id],
    );
    // Eine Baustelle kann mehrfach zugewiesen sein; die relevanteste Zuweisung gewinnt.
    const seen = new Map<string, unknown>();
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.set(r.id, { ...toSite(r), assignment: { validFrom: r.valid_from, validTo: r.valid_to }, activeToday: r.active_today });
      }
    }
    return { sites: [...seen.values()] };
  });

  // ---------------------------------------------------------------- Zeiterfassung

  app.get('/time/current', async (req) => {
    const sessions = await loadSessions(db, 'ws.user_id = $1 AND ws.ended_at IS NULL', [req.auth.id], 1);
    return { session: sessions[0] ?? null, serverTime: new Date().toISOString() };
  });

  app.post('/time/clock-in', async (req) => respond(await clockIn(db, req.auth, clockInSchema.parse(req.body), rules)));
  app.post('/time/pause', async (req) => respond(await startBreak(db, req.auth, simpleOpSchema.parse(req.body))));
  app.post('/time/resume', async (req) => respond(await endBreak(db, req.auth, simpleOpSchema.parse(req.body))));
  app.post('/time/clock-out', async (req) => respond(await clockOut(db, req.auth, clockOutSchema.parse(req.body))));

  /**
   * Nachträgliche Synchronisation offline erfasster Buchungen (in Erfassungsreihenfolge).
   * Jede Buchung ist über ihre clientId idempotent. Ergebnis je Buchung:
   * applied | duplicate | rejected (fachlicher Konflikt, wird nicht erneut gesendet).
   */
  app.post('/time/sync', async (req) => {
    const { ops } = z.object({ ops: z.array(syncOpSchema).min(1).max(200) }).parse(req.body);
    const results = [];
    for (const op of ops) {
      try {
        const input = { ...op, offline: true };
        const r =
          op.type === 'clock_in'
            ? await clockIn(db, req.auth, input as typeof input & { siteId: string }, rules)
            : op.type === 'break_start'
              ? await startBreak(db, req.auth, input)
              : op.type === 'break_end'
                ? await endBreak(db, req.auth, input)
                : await clockOut(db, req.auth, input);
        results.push({ clientId: op.clientId, status: r.duplicate ? 'duplicate' : 'applied', session: r.session });
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) {
          results.push({ clientId: op.clientId, status: 'rejected', error: { code: err.code, message: err.message } });
        } else {
          throw err;
        }
      }
    }
    const current = await loadSessions(db, 'ws.user_id = $1 AND ws.ended_at IS NULL', [req.auth.id], 1);
    return { results, current: current[0] ?? null, serverTime: new Date().toISOString() };
  });

  /** Eigene Arbeitszeiten im Datumsbereich (Kalendertage in Firmenzeitzone). */
  app.get('/time/sessions', async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const sessions = await loadSessions(
      db,
      `ws.user_id = $1 AND (ws.started_at AT TIME ZONE (SELECT timezone FROM companies WHERE id = ws.company_id))::date BETWEEN $2 AND $3`,
      [req.auth.id, q.from, q.to],
    );
    return { sessions };
  });

  // ---------------------------------------------------------------- Korrekturanfragen

  app.post('/correction-requests', async (req) => {
    const body = z
      .object({
        clientId: z.string().uuid(),
        siteId: z.string().uuid(),
        sessionId: z.string().uuid().nullable().optional(),
        requestedStart: isoDateTime,
        requestedEnd: isoDateTime.nullable().optional(),
        reason: z.string().trim().min(10, 'Bitte die Korrektur kurz begründen (mind. 10 Zeichen)').max(2000),
      })
      .parse(req.body);
    const existing = await db.query('SELECT * FROM correction_requests WHERE user_id = $1 AND client_id = $2', [
      req.auth.id,
      body.clientId,
    ]);
    if (existing.rows[0]) return { request: toCorrectionRequest(existing.rows[0]), duplicate: true };
    if (!(await isAssigned(db, req.auth, body.siteId, new Date(body.requestedStart)))) throw new ApiError('NOT_ASSIGNED');
    if (body.requestedEnd && body.requestedEnd <= body.requestedStart) throw new ApiError('TIME_ORDER');
    if (body.sessionId) {
      const own = await db.query('SELECT 1 FROM work_sessions WHERE id = $1 AND user_id = $2', [body.sessionId, req.auth.id]);
      if (!own.rows[0]) throw new ApiError('NOT_FOUND');
    }
    const { rows } = await db.query(
      `INSERT INTO correction_requests (company_id, user_id, site_id, session_id, client_id, requested_start, requested_end, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, client_id) DO UPDATE SET client_id = EXCLUDED.client_id
       RETURNING *`,
      [req.auth.companyId, req.auth.id, body.siteId, body.sessionId ?? null, body.clientId, body.requestedStart, body.requestedEnd ?? null, body.reason],
    );
    return { request: toCorrectionRequest(rows[0]), duplicate: false };
  });

  app.get('/correction-requests', async (req) => {
    const { rows } = await db.query(
      `SELECT cr.*, s.name AS site_name FROM correction_requests cr JOIN sites s ON s.id = cr.site_id
        WHERE cr.user_id = $1 ORDER BY cr.created_at DESC LIMIT 100`,
      [req.auth.id],
    );
    return { requests: rows.map(toCorrectionRequest) };
  });

  // ---------------------------------------------------------------- Tätigkeitsberichte & Fotos

  app.post('/reports', async (req) => {
    const body = z
      .object({
        clientId: z.string().uuid(),
        siteId: z.string().uuid(),
        reportDate: isoDate,
        workDone: z.string().trim().min(1, 'Bitte ausgeführte Arbeiten angeben').max(5000),
        remarks: z.string().trim().max(5000).nullable().optional(),
      })
      .parse(req.body);
    const existing = await db.query('SELECT id FROM reports WHERE user_id = $1 AND client_id = $2', [req.auth.id, body.clientId]);
    if (existing.rows[0]) return { report: await loadReport(existing.rows[0].id), duplicate: true };
    // Mittags-Zeitpunkt vermeidet Datumsverschiebung durch die Zeitzone.
    if (!(await isAssigned(db, req.auth, body.siteId, new Date(`${body.reportDate}T12:00:00Z`)))) {
      throw new ApiError('NOT_ASSIGNED');
    }
    const { rows } = await db.query(
      `INSERT INTO reports (company_id, user_id, site_id, client_id, report_date, work_done, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, client_id) DO UPDATE SET updated_at = reports.updated_at
       RETURNING id`,
      [req.auth.companyId, req.auth.id, body.siteId, body.clientId, body.reportDate, body.workDone, body.remarks || null],
    );
    return { report: await loadReport(rows[0].id), duplicate: false };
  });

  app.get('/reports', async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const { rows } = await db.query(
      `SELECT r.*, s.name AS site_name FROM reports r JOIN sites s ON s.id = r.site_id
        WHERE r.user_id = $1 AND r.report_date BETWEEN $2 AND $3 ORDER BY r.report_date DESC, r.created_at DESC`,
      [req.auth.id, q.from, q.to],
    );
    const photos = await db.query('SELECT * FROM photos WHERE report_id = ANY($1::uuid[]) ORDER BY created_at', [
      rows.map((r) => r.id),
    ]);
    return {
      reports: rows.map((r) => toReport(r, photos.rows.filter((p) => p.report_id === r.id).map(toPhoto))),
    };
  });

  async function loadReport(id: string) {
    const { rows } = await db.query(
      'SELECT r.*, s.name AS site_name FROM reports r JOIN sites s ON s.id = r.site_id WHERE r.id = $1',
      [id],
    );
    const photos = await db.query('SELECT * FROM photos WHERE report_id = $1 ORDER BY created_at', [id]);
    return toReport(rows[0], photos.rows.map(toPhoto));
  }

  /**
   * Foto-Upload (multipart/form-data). Textfelder MÜSSEN vor der Datei stehen:
   * clientId (UUID) und reportId oder reportClientId.
   */
  app.post('/photos', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    if (!req.isMultipart()) throw new ApiError('UPLOAD_INVALID');
    const file = await req.file();
    if (!file) throw new ApiError('UPLOAD_INVALID');
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const meta = z
      .object({
        clientId: z.string().uuid(),
        reportId: z.string().uuid().optional(),
        reportClientId: z.string().uuid().optional(),
      })
      .refine((m) => m.reportId || m.reportClientId, 'reportId oder reportClientId fehlt')
      .parse({ clientId: field('clientId'), reportId: field('reportId'), reportClientId: field('reportClientId') });

    const data = await file.toBuffer();
    if (file.file.truncated) throw new ApiError('UPLOAD_TOO_LARGE');

    const existing = await db.query('SELECT * FROM photos WHERE user_id = $1 AND client_id = $2', [req.auth.id, meta.clientId]);
    if (existing.rows[0]) return { photo: toPhoto(existing.rows[0]), duplicate: true };

    const report = await db.query(
      `SELECT id FROM reports WHERE user_id = $1 AND (id = $2 OR client_id = $3)`,
      [req.auth.id, meta.reportId ?? null, meta.reportClientId ?? null],
    );
    if (!report.rows[0]) throw new ApiError('NOT_FOUND');

    const kind = detectImage(data);
    if (!kind) throw new ApiError('UPLOAD_INVALID');
    const stored = await deps.storage.save(data, kind.ext);
    const { rows } = await db.query(
      `INSERT INTO photos (report_id, user_id, client_id, storage_key, mime, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, client_id) DO NOTHING RETURNING *`,
      [report.rows[0].id, req.auth.id, meta.clientId, stored.key, kind.mime, data.length, stored.sha256],
    );
    if (!rows[0]) {
      // Paralleler Upload mit derselben clientId: vorhandenen Datensatz liefern.
      const again = await db.query('SELECT * FROM photos WHERE user_id = $1 AND client_id = $2', [req.auth.id, meta.clientId]);
      return { photo: toPhoto(again.rows[0]), duplicate: true };
    }
    return { photo: toPhoto(rows[0]), duplicate: false };
  });

  // ---------------------------------------------------------------- Krankmeldung (ohne Diagnose)

  app.post('/sick-notes', async (req) => {
    const body = z
      .object({
        clientId: z.string().uuid(),
        startDate: isoDate,
        expectedEndDate: isoDate,
        certificateProvided: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (body.expectedEndDate < body.startDate) throw new ApiError('TIME_ORDER');
    const { rows } = await db.query(
      `INSERT INTO sick_notes (company_id, user_id, client_id, start_date, expected_end_date, certificate_provided)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, client_id) DO UPDATE SET client_id = EXCLUDED.client_id
       RETURNING *, (xmax <> 0) AS duplicate`,
      [req.auth.companyId, req.auth.id, body.clientId, body.startDate, body.expectedEndDate, body.certificateProvided],
    );
    return { sickNote: toSickNote(rows[0]), duplicate: rows[0].duplicate };
  });

  app.get('/sick-notes', async (req) => {
    const { rows } = await db.query('SELECT * FROM sick_notes WHERE user_id = $1 ORDER BY start_date DESC LIMIT 50', [
      req.auth.id,
    ]);
    return { sickNotes: rows.map(toSickNote) };
  });

  // ---------------------------------------------------------------- Entfernung Wohnort → Baustelle

  app.get('/sites/:siteId/distance', async (req): Promise<{ distance: DistanceDto }> => {
    const { siteId } = z.object({ siteId: z.string().uuid() }).parse(req.params);
    const site = await db.query(
      `SELECT s.lat, s.lng FROM sites s
        WHERE s.id = $1 AND s.company_id = $2 AND EXISTS (SELECT 1 FROM site_assignments sa WHERE sa.site_id = s.id AND sa.user_id = $3)`,
      [siteId, req.auth.companyId, req.auth.id],
    );
    if (!site.rows[0]) throw new ApiError('NOT_FOUND');
    const home = await db.query('SELECT lat, lng FROM employee_home WHERE user_id = $1', [req.auth.id]);
    if (!home.rows[0]) throw new ApiError('HOME_ADDRESS_MISSING', undefined, 404);

    const homeHash = sha256(`${home.rows[0].lat},${home.rows[0].lng}`);
    const cached = await db.query(
      `SELECT * FROM route_cache WHERE user_id = $1 AND site_id = $2 AND home_hash = $3 AND provider = $4
          AND computed_at > now() - interval '30 days'`,
      [req.auth.id, siteId, homeHash, deps.routing.name],
    );
    let result = cached.rows[0]
      ? { distanceM: cached.rows[0].distance_m, durationS: cached.rows[0].duration_s, provider: cached.rows[0].provider, simulated: cached.rows[0].simulated }
      : null;
    if (!result) {
      try {
        result = await deps.routing.route(home.rows[0], site.rows[0]);
      } catch (err) {
        req.log.warn({ err }, 'Routing fehlgeschlagen');
        throw new ApiError('ROUTING_FAILED');
      }
      await db.query(
        `INSERT INTO route_cache (user_id, site_id, home_hash, provider, distance_m, duration_s, simulated)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, site_id) DO UPDATE SET home_hash = $3, provider = $4, distance_m = $5, duration_s = $6,
           simulated = $7, computed_at = now()`,
        [req.auth.id, siteId, homeHash, result.provider, result.distanceM, result.durationS, result.simulated],
      );
    }
    return { distance: { siteId, ...result, oneWay: true } };
  });
}
