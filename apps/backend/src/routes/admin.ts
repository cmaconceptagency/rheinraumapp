import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ROLES, VERIFICATION_LABELS, type Verification } from '@rheinraum/shared';
import type { AppDeps } from '../app.js';
import { ApiError } from '../errors.js';
import { tx, type DbClient } from '../db/pool.js';
import { hashPassword, inviteCode, sha256 } from '../auth/crypto.js';
import { requireHrAccess, requireRole, type AuthUser } from '../auth/plugin.js';
import { Scope } from '../services/scope.js';
import { toCorrectionRequest, toPhoto, toReport, toSickNote, toSite, toUser } from '../services/mappers.js';
import { loadSession, loadSessions } from '../services/time.js';
import { applyCorrection, applyCorrectionInTx, createManualSession, listCorrections, reviewSession } from '../services/corrections.js';
import { toCsv } from '../services/csv.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const isoDateTime = z.string().datetime({ offset: true });
const idParam = z.object({ id: uuid });
const reason = z.string().trim().min(5, 'Bitte eine Begründung angeben (mind. 5 Zeichen)').max(2000);
const optText = z.string().trim().max(500).nullable().optional();
const adminOnly = { preHandler: requireRole('admin') };

const siteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  street: z.string().trim().min(1).max(200),
  zip: z.string().trim().min(4).max(10),
  city: z.string().trim().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50).max(10000).default(500),
  contactName: optText,
  contactPhone: optText,
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

const userSchema = z.object({
  email: z.string().trim().email().max(200),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(ROLES).default('employee'),
  hrAccess: z.boolean().default(false),
  personnelNo: optText,
  phone: optText,
  /** Optional: Startpasswort direkt setzen statt Einladung. */
  password: z.string().min(10).max(200).optional(),
});

export async function adminRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config } = deps;
  app.addHook('preHandler', deps.authenticate);
  app.addHook('preHandler', requireRole('admin', 'site_manager'));

  async function assertSeatAvailable(companyId: string, client: DbClient = db) {
    const { rows } = await client.query(
      `SELECT c.licensed_seats, (SELECT count(*)::int FROM users u WHERE u.company_id = c.id AND u.active) AS used
         FROM companies c WHERE c.id = $1`,
      [companyId],
    );
    if (rows[0].used >= rows[0].licensed_seats) {
      throw new ApiError('SEAT_LIMIT', { licensed: rows[0].licensed_seats, used: rows[0].used });
    }
  }

  async function createInvite(userId: string, client: DbClient = db) {
    const code = inviteCode();
    await client.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
    const { rows } = await client.query(
      `INSERT INTO invites (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3)) RETURNING expires_at`,
      [userId, sha256(code), config.INVITE_TTL_DAYS],
    );
    // SIMULIERT: Es wird keine E-Mail versendet. Der Code wird einmalig in der Admin-Oberfläche angezeigt.
    return { code, expiresAt: rows[0].expires_at.toISOString(), delivery: 'simulated' as const };
  }

  // ---------------------------------------------------------------- Übersicht

  app.get('/overview', async (req) => {
    const s1 = new Scope(req.auth);
    const open = await loadSessions(db, `ws.ended_at IS NULL AND ${s1.records('ws')}`, s1.params, 500);
    const s2 = new Scope(req.auth);
    const pending = await db.query(
      `SELECT count(*)::int AS n FROM correction_requests cr WHERE cr.status = 'pending' AND ${s2.records('cr')}`,
      s2.params,
    );
    const s3 = new Scope(req.auth);
    const unverified = await db.query(
      `SELECT count(*)::int AS n FROM work_sessions ws
        WHERE ws.verification = 'unverified' AND ws.reviewed_at IS NULL AND ${s3.records('ws')}`,
      s3.params,
    );
    const seats = await db.query(
      `SELECT c.name, c.licensed_seats, (SELECT count(*)::int FROM users u WHERE u.company_id = c.id AND u.active) AS used
         FROM companies c WHERE c.id = $1`,
      [req.auth.companyId],
    );
    return {
      openSessions: open,
      pendingCorrectionRequests: pending.rows[0].n,
      unverifiedSessions: unverified.rows[0].n,
      company: { name: seats.rows[0].name, licensedSeats: seats.rows[0].licensed_seats, usedSeats: seats.rows[0].used },
      serverTime: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------- Mitarbeiter

  app.get('/users', async (req) => {
    const q = z.object({ includeInactive: z.coerce.boolean().optional() }).parse(req.query);
    const scope = new Scope(req.auth);
    const { rows } = await db.query(
      `SELECT u.* FROM users u WHERE ${scope.users('u')} ${q.includeInactive ? '' : 'AND u.active'}
        ORDER BY u.active DESC, u.last_name, u.first_name`,
      scope.params,
    );
    return { users: rows.map(toUser) };
  });

  app.post('/users', adminOnly, async (req) => {
    const body = userSchema.parse(req.body);
    if (body.hrAccess && (!req.auth.hrAccess || body.role !== 'admin')) throw new ApiError('FORBIDDEN');
    return tx(db, async (client) => {
      await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [req.auth.companyId]);
      await assertSeatAvailable(req.auth.companyId, client);
      const dupe = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
      if (dupe.rows[0]) throw new ApiError('VALIDATION', { field: 'email', message: 'E-Mail-Adresse wird bereits verwendet' });
      const { rows } = await client.query(
        `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role, hr_access, personnel_no, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          req.auth.companyId,
          body.email,
          body.password ? await hashPassword(body.password) : null,
          body.firstName,
          body.lastName,
          body.role,
          body.hrAccess,
          body.personnelNo || null,
          body.phone || null,
        ],
      );
      const invite = body.password ? null : await createInvite(rows[0].id, client);
      return { user: toUser(rows[0]), invite };
    });
  });

  app.patch('/users/:id', adminOnly, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = userSchema.omit({ password: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body);
    return tx(db, async (client) => {
      const cur = await client.query('SELECT * FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, req.auth.companyId]);
      const u = cur.rows[0];
      if (!u) throw new ApiError('NOT_FOUND');
      if (id === req.auth.id && (body.active === false || (body.role && body.role !== 'admin'))) {
        throw new ApiError('FORBIDDEN', { reason: 'Eigenes Administratorkonto kann nicht deaktiviert oder herabgestuft werden' });
      }
      if (body.hrAccess !== undefined && body.hrAccess !== u.hr_access && !req.auth.hrAccess) throw new ApiError('FORBIDDEN');
      const role = body.role ?? u.role;
      const hrAccess = role === 'admin' ? (body.hrAccess ?? u.hr_access) : false;
      if (body.active === true && !u.active) {
        await client.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [req.auth.companyId]);
        await assertSeatAvailable(req.auth.companyId, client);
      }
      if (body.email && body.email.toLowerCase() !== u.email.toLowerCase()) {
        const dupe = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [body.email]);
        if (dupe.rows[0]) throw new ApiError('VALIDATION', { field: 'email', message: 'E-Mail-Adresse wird bereits verwendet' });
      }
      const { rows } = await client.query(
        `UPDATE users SET email = $2, first_name = $3, last_name = $4, role = $5, hr_access = $6,
                personnel_no = $7, phone = $8, active = $9, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [
          id,
          body.email ?? u.email,
          body.firstName ?? u.first_name,
          body.lastName ?? u.last_name,
          role,
          hrAccess,
          body.personnelNo !== undefined ? body.personnelNo || null : u.personnel_no,
          body.phone !== undefined ? body.phone || null : u.phone,
          body.active ?? u.active,
        ],
      );
      if (body.active === false) {
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      }
      return { user: toUser(rows[0]) };
    });
  });

  app.post('/users/:id/invite', adminOnly, async (req) => {
    const { id } = idParam.parse(req.params);
    const u = await db.query('SELECT id, active FROM users WHERE id = $1 AND company_id = $2', [id, req.auth.companyId]);
    if (!u.rows[0]) throw new ApiError('NOT_FOUND');
    if (!u.rows[0].active) throw new ApiError('ACCOUNT_INACTIVE');
    return { invite: await createInvite(id) };
  });

  /** Wohnadresse: nur Administratoren mit ausdrücklicher HR-Berechtigung. */
  app.get('/users/:id/home', { preHandler: requireHrAccess }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { rows } = await db.query(
      `SELECT h.* FROM employee_home h JOIN users u ON u.id = h.user_id WHERE h.user_id = $1 AND u.company_id = $2`,
      [id, req.auth.companyId],
    );
    const h = rows[0];
    return { home: h ? { street: h.street, zip: h.zip, city: h.city, lat: h.lat, lng: h.lng } : null };
  });

  app.put('/users/:id/home', { preHandler: requireHrAccess }, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        street: z.string().trim().min(1).max(200),
        zip: z.string().trim().min(4).max(10),
        city: z.string().trim().min(1).max(100),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .parse(req.body);
    const u = await db.query('SELECT 1 FROM users WHERE id = $1 AND company_id = $2', [id, req.auth.companyId]);
    if (!u.rows[0]) throw new ApiError('NOT_FOUND');
    await db.query(
      `INSERT INTO employee_home (user_id, street, zip, city, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET street = $2, zip = $3, city = $4, lat = $5, lng = $6, updated_at = now()`,
      [id, body.street, body.zip, body.city, body.lat, body.lng],
    );
    await db.query('DELETE FROM route_cache WHERE user_id = $1', [id]);
    return { home: body };
  });

  // ---------------------------------------------------------------- Baustellen

  app.get('/sites', async (req) => {
    const q = z.object({ includeInactive: z.coerce.boolean().optional() }).parse(req.query);
    const scope = new Scope(req.auth);
    const { rows } = await db.query(
      `SELECT s.*, COALESCE((SELECT json_agg(sm.user_id) FROM site_managers sm WHERE sm.site_id = s.id), '[]') AS manager_ids
         FROM sites s WHERE ${scope.sites('s')} ${q.includeInactive ? '' : 'AND s.active'}
        ORDER BY s.active DESC, s.name`,
      scope.params,
    );
    return { sites: rows.map((r) => ({ ...toSite(r), managerIds: r.manager_ids })) };
  });

  app.post('/sites', adminOnly, async (req) => {
    const b = siteSchema.parse(req.body);
    const { rows } = await db.query(
      `INSERT INTO sites (company_id, name, street, zip, city, lat, lng, radius_m, contact_name, contact_phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [req.auth.companyId, b.name, b.street, b.zip, b.city, b.lat, b.lng, b.radiusM, b.contactName || null, b.contactPhone || null, b.notes || null],
    );
    return { site: toSite(rows[0]) };
  });

  app.patch('/sites/:id', adminOnly, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = siteSchema.partial().parse(req.body);
    const cur = await db.query('SELECT * FROM sites WHERE id = $1 AND company_id = $2', [id, req.auth.companyId]);
    const s = cur.rows[0];
    if (!s) throw new ApiError('NOT_FOUND');
    const pick = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
    const { rows } = await db.query(
      `UPDATE sites SET name = $2, street = $3, zip = $4, city = $5, lat = $6, lng = $7, radius_m = $8,
              contact_name = $9, contact_phone = $10, notes = $11, active = $12, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [
        id,
        pick(b.name, s.name),
        pick(b.street, s.street),
        pick(b.zip, s.zip),
        pick(b.city, s.city),
        pick(b.lat, s.lat),
        pick(b.lng, s.lng),
        pick(b.radiusM, s.radius_m),
        pick(b.contactName, s.contact_name) || null,
        pick(b.contactPhone, s.contact_phone) || null,
        pick(b.notes, s.notes) || null,
        pick(b.active, s.active),
      ],
    );
    return { site: toSite(rows[0]) };
  });

  app.put('/sites/:id/managers', adminOnly, async (req) => {
    const { id } = idParam.parse(req.params);
    const { userIds } = z.object({ userIds: z.array(uuid).max(50) }).parse(req.body);
    await tx(db, async (client) => {
      const site = await client.query('SELECT 1 FROM sites WHERE id = $1 AND company_id = $2', [id, req.auth.companyId]);
      if (!site.rows[0]) throw new ApiError('NOT_FOUND');
      const valid = await client.query(
        `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND company_id = $2 AND role IN ('site_manager', 'admin')`,
        [userIds, req.auth.companyId],
      );
      if (valid.rows.length !== new Set(userIds).size) throw new ApiError('VALIDATION', { field: 'userIds' });
      await client.query('DELETE FROM site_managers WHERE site_id = $1', [id]);
      for (const u of new Set(userIds)) await client.query('INSERT INTO site_managers (site_id, user_id) VALUES ($1, $2)', [id, u]);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Zuweisungen

  app.get('/assignments', async (req) => {
    const q = z.object({ siteId: uuid.optional(), userId: uuid.optional(), activeOn: isoDate.optional() }).parse(req.query);
    const scope = new Scope(req.auth);
    const where = [scope.sites('s'), scope.users('u')];
    if (q.siteId) where.push(`sa.site_id = ${scope.p(q.siteId)}`);
    if (q.userId) where.push(`sa.user_id = ${scope.p(q.userId)}`);
    if (q.activeOn) {
      const d = scope.p(q.activeOn);
      where.push(`sa.valid_from <= ${d} AND (sa.valid_to IS NULL OR sa.valid_to >= ${d})`);
    }
    const { rows } = await db.query(
      `SELECT sa.*, s.name AS site_name, u.first_name || ' ' || u.last_name AS user_name
         FROM site_assignments sa JOIN sites s ON s.id = sa.site_id JOIN users u ON u.id = sa.user_id
        WHERE ${where.join(' AND ')} ORDER BY sa.valid_from DESC, s.name`,
      scope.params,
    );
    return {
      assignments: rows.map((r) => ({
        id: r.id,
        siteId: r.site_id,
        userId: r.user_id,
        validFrom: r.valid_from,
        validTo: r.valid_to,
        siteName: r.site_name,
        userName: r.user_name,
      })),
    };
  });

  /** Admin: beliebig. Bauleiter: nur eigene Baustellen und für ihn sichtbare Mitarbeiter. */
  async function assertCanAssign(req: { auth: AuthUser }, siteId: string, userId: string) {
    const scope = new Scope(req.auth, [siteId, userId]);
    const { rows } = await db.query(
      `SELECT 1 FROM sites s, users u WHERE s.id = $1 AND u.id = $2 AND s.active AND u.active
          AND ${scope.sites('s')} AND ${scope.users('u')}`,
      scope.params,
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND');
  }

  app.post('/assignments', async (req) => {
    const b = z
      .object({ siteId: uuid, userId: uuid, validFrom: isoDate, validTo: isoDate.nullable().optional() })
      .parse(req.body);
    if (b.validTo && b.validTo < b.validFrom) throw new ApiError('TIME_ORDER');
    await assertCanAssign(req, b.siteId, b.userId);
    const { rows } = await db.query(
      `INSERT INTO site_assignments (site_id, user_id, valid_from, valid_to, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [b.siteId, b.userId, b.validFrom, b.validTo ?? null, req.auth.id],
    );
    return { assignment: { id: rows[0].id, siteId: b.siteId, userId: b.userId, validFrom: rows[0].valid_from, validTo: rows[0].valid_to } };
  });

  app.patch('/assignments/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ validFrom: isoDate.optional(), validTo: isoDate.nullable().optional() }).parse(req.body);
    const cur = await db.query('SELECT * FROM site_assignments WHERE id = $1', [id]);
    if (!cur.rows[0]) throw new ApiError('NOT_FOUND');
    await assertCanAssign(req, cur.rows[0].site_id, cur.rows[0].user_id);
    const validFrom = b.validFrom ?? cur.rows[0].valid_from;
    const validTo = b.validTo !== undefined ? b.validTo : cur.rows[0].valid_to;
    if (validTo && validTo < validFrom) throw new ApiError('TIME_ORDER');
    await db.query('UPDATE site_assignments SET valid_from = $2, valid_to = $3 WHERE id = $1', [id, validFrom, validTo]);
    return { ok: true };
  });

  app.delete('/assignments/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const cur = await db.query('SELECT * FROM site_assignments WHERE id = $1', [id]);
    if (!cur.rows[0]) throw new ApiError('NOT_FOUND');
    await assertCanAssign(req, cur.rows[0].site_id, cur.rows[0].user_id);
    await db.query('DELETE FROM site_assignments WHERE id = $1', [id]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- Teams

  app.get('/teams', async (req) => {
    const params: unknown[] = [req.auth.companyId];
    let filter = '';
    if (req.auth.role === 'site_manager') {
      params.push(req.auth.id);
      filter = 'AND t.manager_id = $2';
    }
    const { rows } = await db.query(
      `SELECT t.*, m.first_name || ' ' || m.last_name AS manager_name,
              COALESCE((SELECT json_agg(tm.user_id) FROM team_members tm WHERE tm.team_id = t.id), '[]') AS member_ids
         FROM teams t LEFT JOIN users m ON m.id = t.manager_id
        WHERE t.company_id = $1 ${filter} ORDER BY t.name`,
      params,
    );
    return {
      teams: rows.map((r) => ({ id: r.id, name: r.name, managerId: r.manager_id, managerName: r.manager_name, memberIds: r.member_ids })),
    };
  });

  const teamSchema = z.object({ name: z.string().trim().min(1).max(100), managerId: uuid.nullable().optional(), memberIds: z.array(uuid).max(500).default([]) });

  async function saveTeam(companyId: string, teamId: string | null, b: z.infer<typeof teamSchema>) {
    return tx(db, async (client) => {
      if (b.managerId) {
        const m = await client.query(
          `SELECT 1 FROM users WHERE id = $1 AND company_id = $2 AND role IN ('site_manager', 'admin')`,
          [b.managerId, companyId],
        );
        if (!m.rows[0]) throw new ApiError('VALIDATION', { field: 'managerId' });
      }
      const members = [...new Set(b.memberIds)];
      const valid = await client.query('SELECT id FROM users WHERE id = ANY($1::uuid[]) AND company_id = $2', [members, companyId]);
      if (valid.rows.length !== members.length) throw new ApiError('VALIDATION', { field: 'memberIds' });
      let id = teamId;
      if (id) {
        const r = await client.query('UPDATE teams SET name = $3, manager_id = $4 WHERE id = $1 AND company_id = $2 RETURNING id', [
          id,
          companyId,
          b.name,
          b.managerId ?? null,
        ]);
        if (!r.rows[0]) throw new ApiError('NOT_FOUND');
        await client.query('DELETE FROM team_members WHERE team_id = $1', [id]);
      } else {
        const r = await client.query('INSERT INTO teams (company_id, name, manager_id) VALUES ($1, $2, $3) RETURNING id', [
          companyId,
          b.name,
          b.managerId ?? null,
        ]);
        id = r.rows[0].id as string;
      }
      for (const m of members) await client.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [id, m]);
      return { id };
    });
  }

  app.post('/teams', adminOnly, async (req) => ({ team: await saveTeam(req.auth.companyId, null, teamSchema.parse(req.body)) }));
  app.put('/teams/:id', adminOnly, async (req) => {
    const { id } = idParam.parse(req.params);
    return { team: await saveTeam(req.auth.companyId, id, teamSchema.parse(req.body)) };
  });

  // ---------------------------------------------------------------- Arbeitszeiten

  const sessionFilter = z.object({
    from: isoDate,
    to: isoDate,
    userId: uuid.optional(),
    siteId: uuid.optional(),
    verification: z.enum(['verified', 'unverified', 'corrected', 'manual']).optional(),
    openOnly: z.coerce.boolean().optional(),
  });

  function sessionWhere(auth: AuthUser, q: z.infer<typeof sessionFilter>) {
    const scope = new Scope(auth);
    const where = [scope.records('ws')];
    const tz = `(SELECT timezone FROM companies WHERE id = ws.company_id)`;
    where.push(`(ws.started_at AT TIME ZONE ${tz})::date BETWEEN ${scope.p(q.from)} AND ${scope.p(q.to)}`);
    if (q.userId) where.push(`ws.user_id = ${scope.p(q.userId)}`);
    if (q.siteId) where.push(`ws.site_id = ${scope.p(q.siteId)}`);
    if (q.verification) where.push(`ws.verification = ${scope.p(q.verification)}`);
    if (q.openOnly) where.push('ws.ended_at IS NULL');
    return { where: where.join(' AND '), params: scope.params };
  }

  app.get('/sessions', async (req) => {
    const q = sessionFilter.parse(req.query);
    const { where, params } = sessionWhere(req.auth, q);
    return { sessions: await loadSessions(db, where, params, 2000) };
  });

  async function assertSessionVisible(auth: AuthUser, id: string) {
    const scope = new Scope(auth, [id]);
    const { rows } = await db.query(`SELECT 1 FROM work_sessions ws WHERE ws.id = $1 AND ${scope.records('ws')}`, scope.params);
    if (!rows[0]) throw new ApiError('NOT_FOUND');
  }

  app.get('/sessions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    await assertSessionVisible(req.auth, id);
    return { session: await loadSession(db, id), corrections: await listCorrections(db, id) };
  });

  app.post('/sessions/:id/corrections', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        reason,
        startedAt: isoDateTime.optional(),
        endedAt: isoDateTime.nullable().optional(),
        siteId: uuid.optional(),
        breaks: z.array(z.object({ startedAt: isoDateTime, endedAt: isoDateTime })).max(20).optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(req.body);
    const session = await applyCorrection(db, req.auth, id, b);
    return { session, corrections: await listCorrections(db, id) };
  });

  app.post('/sessions/:id/review', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ reason }).parse(req.body);
    const session = await reviewSession(db, req.auth, id, b.reason);
    return { session, corrections: await listCorrections(db, id) };
  });

  app.post('/sessions', async (req) => {
    const b = z
      .object({ userId: uuid, siteId: uuid, startedAt: isoDateTime, endedAt: isoDateTime.nullable(), reason })
      .parse(req.body);
    const id = await createManualSession(db, req.auth, b);
    return { session: await loadSession(db, id) };
  });

  // ---------------------------------------------------------------- Korrekturanfragen

  app.get('/correction-requests', async (req) => {
    const q = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).parse(req.query);
    const scope = new Scope(req.auth);
    const where = [scope.records('cr')];
    if (q.status) where.push(`cr.status = ${scope.p(q.status)}`);
    const { rows } = await db.query(
      `SELECT cr.*, s.name AS site_name, u.first_name || ' ' || u.last_name AS user_name
         FROM correction_requests cr JOIN sites s ON s.id = cr.site_id JOIN users u ON u.id = cr.user_id
        WHERE ${where.join(' AND ')} ORDER BY cr.created_at DESC LIMIT 500`,
      scope.params,
    );
    return { requests: rows.map(toCorrectionRequest) };
  });

  async function lockPendingRequest(client: PoolClient, auth: AuthUser, id: string) {
    const scope = new Scope(auth, [id]);
    const { rows } = await client.query(
      `SELECT cr.* FROM correction_requests cr WHERE cr.id = $1 AND ${scope.records('cr')} FOR UPDATE`,
      scope.params,
    );
    if (!rows[0]) throw new ApiError('NOT_FOUND');
    if (rows[0].status !== 'pending') throw new ApiError('VALIDATION', { reason: 'Anfrage wurde bereits bearbeitet' });
    return rows[0];
  }

  app.post('/correction-requests/:id/approve', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    const sessionId = await tx(db, async (client) => {
      const cr = await lockPendingRequest(client, req.auth, id);
      const why = `Korrekturanfrage genehmigt: ${cr.reason}`;
      let target: string;
      if (cr.session_id) {
        target = cr.session_id;
        await applyCorrectionInTx(client, req.auth, target, {
          reason: why,
          startedAt: cr.requested_start.toISOString(),
          ...(cr.requested_end ? { endedAt: cr.requested_end.toISOString() } : {}),
        }, { allowNoop: true });
      } else {
        target = await createManualSession(
          db,
          req.auth,
          {
            userId: cr.user_id,
            siteId: cr.site_id,
            startedAt: cr.requested_start.toISOString(),
            endedAt: cr.requested_end?.toISOString() ?? null,
            reason: why,
          },
          client,
        );
      }
      await client.query(
        `UPDATE correction_requests SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3,
                session_id = $4 WHERE id = $1`,
        [id, req.auth.id, b.note ?? null, target],
      );
      return target;
    });
    return { ok: true, sessionId };
  });

  app.post('/correction-requests/:id/reject', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ note: z.string().trim().min(3, 'Bitte Ablehnung kurz begründen').max(1000) }).parse(req.body);
    await tx(db, async (client) => {
      await lockPendingRequest(client, req.auth, id);
      await client.query(
        `UPDATE correction_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3 WHERE id = $1`,
        [id, req.auth.id, b.note],
      );
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- Berichte & Fotos

  app.get('/reports', async (req) => {
    const q = z.object({ from: isoDate, to: isoDate, userId: uuid.optional(), siteId: uuid.optional() }).parse(req.query);
    const scope = new Scope(req.auth);
    const where = [scope.records('r'), `r.report_date BETWEEN ${scope.p(q.from)} AND ${scope.p(q.to)}`];
    if (q.userId) where.push(`r.user_id = ${scope.p(q.userId)}`);
    if (q.siteId) where.push(`r.site_id = ${scope.p(q.siteId)}`);
    const { rows } = await db.query(
      `SELECT r.*, s.name AS site_name, u.first_name || ' ' || u.last_name AS user_name
         FROM reports r JOIN sites s ON s.id = r.site_id JOIN users u ON u.id = r.user_id
        WHERE ${where.join(' AND ')} ORDER BY r.report_date DESC, r.created_at DESC LIMIT 1000`,
      scope.params,
    );
    const photos = await db.query('SELECT * FROM photos WHERE report_id = ANY($1::uuid[]) ORDER BY created_at', [rows.map((r) => r.id)]);
    return { reports: rows.map((r) => toReport(r, photos.rows.filter((p) => p.report_id === r.id).map(toPhoto))) };
  });

  // ---------------------------------------------------------------- Krankmeldungen (nur HR-Berechtigung)

  app.get('/sick-notes', { preHandler: requireHrAccess }, async (req) => {
    const q = z.object({ from: isoDate.optional(), to: isoDate.optional(), userId: uuid.optional() }).parse(req.query);
    const params: unknown[] = [req.auth.companyId];
    const where = ['sn.company_id = $1'];
    if (q.from) where.push(`sn.expected_end_date >= $${params.push(q.from)}`);
    if (q.to) where.push(`sn.start_date <= $${params.push(q.to)}`);
    if (q.userId) where.push(`sn.user_id = $${params.push(q.userId)}`);
    const { rows } = await db.query(
      `SELECT sn.*, u.first_name || ' ' || u.last_name AS user_name FROM sick_notes sn JOIN users u ON u.id = sn.user_id
        WHERE ${where.join(' AND ')} ORDER BY sn.start_date DESC LIMIT 500`,
      params,
    );
    return { sickNotes: rows.map(toSickNote) };
  });

  // ---------------------------------------------------------------- CSV-Export

  app.get('/export/time.csv', async (req, reply) => {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Monat im Format JJJJ-MM') }).parse(req.query);
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const q = { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
    const { where, params } = sessionWhere(req.auth, q);
    const sessions = (await loadSessions(db, where, params, 5000)).reverse();
    const tzRow = await db.query('SELECT timezone FROM companies WHERE id = $1', [req.auth.companyId]);
    const tz = tzRow.rows[0].timezone as string;
    const pers = await db.query('SELECT id, personnel_no FROM users WHERE company_id = $1', [req.auth.companyId]);
    const persNo = new Map(pers.rows.map((r) => [r.id, r.personnel_no]));
    const date = new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const csv = toCsv(
      ['Personalnr.', 'Mitarbeiter', 'Datum', 'Baustelle', 'Beginn', 'Ende', 'Pause (Min.)', 'Netto (Std.)', 'Status', 'Geprüft', 'Hinweis'],
      sessions
        .sort((a, b) => (a.userName ?? '').localeCompare(b.userName ?? '') || a.startedAt.localeCompare(b.startedAt))
        .map((s) => [
          persNo.get(s.userId) ?? '',
          s.userName ?? '',
          date.format(new Date(s.startedAt)),
          s.siteName ?? '',
          time.format(new Date(s.startedAt)),
          s.endedAt ? time.format(new Date(s.endedAt)) : 'läuft',
          Math.round(s.totals.breakMs / 60000),
          Math.round((s.totals.netMs / 3600000) * 100) / 100,
          VERIFICATION_LABELS[s.verification as Verification],
          s.reviewedAt ? 'ja' : '',
          s.breakHint ?? '',
        ]),
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="arbeitszeiten-${month}.csv"`)
      .send(csv);
  });
}
