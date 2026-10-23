import type pg from 'pg';
import type { CorrectionDto } from '@rheinraum/shared';
import { ApiError } from '../errors.js';
import { tx, type Db } from '../db/pool.js';
import type { AuthUser } from '../auth/plugin.js';
import { Scope } from './scope.js';
import { loadSession } from './time.js';

export interface CorrectionInput {
  reason: string;
  startedAt?: string;
  endedAt?: string | null;
  siteId?: string;
  breaks?: { startedAt: string; endedAt: string }[];
  note?: string | null;
}

async function snapshot(client: pg.PoolClient, sessionId: string) {
  const s = await client.query(
    'SELECT site_id, started_at, ended_at, verification, note FROM work_sessions WHERE id = $1',
    [sessionId],
  );
  const b = await client.query('SELECT started_at, ended_at FROM work_breaks WHERE session_id = $1 ORDER BY started_at', [
    sessionId,
  ]);
  const r = s.rows[0];
  return {
    siteId: r.site_id,
    startedAt: r.started_at?.toISOString() ?? null,
    endedAt: r.ended_at?.toISOString() ?? null,
    verification: r.verification,
    note: r.note,
    breaks: b.rows.map((x) => ({ startedAt: x.started_at.toISOString(), endedAt: x.ended_at?.toISOString() ?? null })),
  };
}

/** Lädt eine Sitzung mit Zeilensperre, sofern sie für den Benutzer sichtbar ist. */
async function lockVisibleSession(client: pg.PoolClient, user: AuthUser, sessionId: string) {
  const scope = new Scope(user, [sessionId]);
  const { rows } = await client.query(
    `SELECT ws.* FROM work_sessions ws WHERE ws.id = $1 AND ${scope.records('ws')} FOR UPDATE`,
    scope.params,
  );
  if (!rows[0]) throw new ApiError('NOT_FOUND');
  return rows[0];
}

async function assertNoOverlap(
  client: pg.PoolClient,
  userId: string,
  start: Date,
  end: Date | null,
  excludeId: string | null,
) {
  const { rows } = await client.query(
    `SELECT id FROM work_sessions
      WHERE user_id = $1 AND ($4::uuid IS NULL OR id <> $4)
        AND tstzrange(started_at, COALESCE(ended_at, 'infinity')) && tstzrange($2, COALESCE($3::timestamptz, 'infinity'))`,
    [userId, start, end, excludeId],
  );
  if (rows[0]) throw new ApiError('TIME_ORDER', { overlapsSession: rows[0].id });
}

/** Zeitkorrektur durch Admin/Bauleiter. Jede Änderung wird unveränderbar in time_corrections protokolliert. */
export async function applyCorrection(db: Db, user: AuthUser, sessionId: string, input: CorrectionInput) {
  await tx(db, (client) => applyCorrectionInTx(client, user, sessionId, input));
  return loadSession(db, sessionId);
}

export async function applyCorrectionInTx(
  client: pg.PoolClient,
  user: AuthUser,
  sessionId: string,
  input: CorrectionInput,
  opts: { allowNoop?: boolean } = {},
) {
  {
    const session = await lockVisibleSession(client, user, sessionId);
    const before = await snapshot(client, sessionId);

    const startedAt = input.startedAt ? new Date(input.startedAt) : session.started_at;
    const endedAt = input.endedAt !== undefined ? (input.endedAt ? new Date(input.endedAt) : null) : session.ended_at;
    if (session.ended_at && !endedAt) throw new ApiError('TIME_ORDER', { reason: 'Abgeschlossene Sitzung kann nicht wieder geöffnet werden' });
    if (endedAt && endedAt < startedAt) throw new ApiError('TIME_ORDER');
    await assertNoOverlap(client, session.user_id, startedAt, endedAt, sessionId);

    let siteId = session.site_id;
    if (input.siteId && input.siteId !== session.site_id) {
      const scope = new Scope(user, [input.siteId]);
      const site = await client.query(`SELECT id FROM sites s WHERE s.id = $1 AND ${scope.sites('s')}`, scope.params);
      if (!site.rows[0]) throw new ApiError('NOT_FOUND');
      siteId = input.siteId;
    }

    if (input.breaks) {
      for (const b of input.breaks) {
        const bs = new Date(b.startedAt);
        const be = new Date(b.endedAt);
        if (be < bs || bs < startedAt || (endedAt && be > endedAt)) throw new ApiError('TIME_ORDER', { break: b });
      }
      await client.query('DELETE FROM work_breaks WHERE session_id = $1', [sessionId]);
      for (const b of input.breaks) {
        await client.query(
          'INSERT INTO work_breaks (session_id, client_id, started_at, ended_at) VALUES ($1, gen_random_uuid(), $2, $3)',
          [sessionId, b.startedAt, b.endedAt],
        );
      }
    } else if (endedAt) {
      // Offene Pausen werden mit dem korrigierten Ende geschlossen bzw. darauf begrenzt.
      await client.query(
        'UPDATE work_breaks SET ended_at = LEAST(COALESCE(ended_at, $2), $2) WHERE session_id = $1',
        [sessionId, endedAt],
      );
    }

    await client.query(
      `UPDATE work_sessions SET started_at = $2, ended_at = $3, site_id = $4, note = COALESCE($5, note),
              verification = 'corrected', updated_at = now()
        WHERE id = $1`,
      [sessionId, startedAt, endedAt, siteId, input.note ?? null],
    );
    const after = await snapshot(client, sessionId);
    const comparable = (x: typeof before) => JSON.stringify({ ...x, verification: undefined });
    if (!opts.allowNoop && comparable(before) === comparable(after)) {
      throw new ApiError('VALIDATION', { reason: 'Keine Änderung gegenüber dem bisherigen Stand' });
    }
    await client.query(
      'INSERT INTO time_corrections (session_id, changed_by, reason, before, after) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, user.id, input.reason.trim(), before, after],
    );
  }
}

/** Bestätigt, dass eine ungeprüfte Buchung kontrolliert wurde. Die Kennzeichnung "ungeprüft" bleibt erhalten. */
export async function reviewSession(db: Db, user: AuthUser, sessionId: string, reason: string) {
  await tx(db, async (client) => {
    const session = await lockVisibleSession(client, user, sessionId);
    const before = await snapshot(client, sessionId);
    await client.query('UPDATE work_sessions SET reviewed_by = $2, reviewed_at = now() WHERE id = $1', [
      session.id,
      user.id,
    ]);
    await client.query(
      'INSERT INTO time_corrections (session_id, changed_by, reason, before, after) VALUES ($1, $2, $3, $4, $5)',
      [sessionId, user.id, reason.trim(), before, { ...before, reviewed: true }],
    );
  });
  return loadSession(db, sessionId);
}

export interface ManualSessionInput {
  userId: string;
  siteId: string;
  startedAt: string;
  endedAt: string | null;
  reason: string;
}

/** Manuell erfasste Sitzung (z. B. nach genehmigter Korrekturanfrage). */
export async function createManualSession(
  db: Db,
  user: AuthUser,
  input: ManualSessionInput,
  client?: pg.PoolClient,
): Promise<string> {
  const run = async (c: pg.PoolClient) => {
    const scope = new Scope(user, [input.userId]);
    const target = await c.query(`SELECT u.id FROM users u WHERE u.id = $1 AND ${scope.users('u')}`, scope.params);
    if (!target.rows[0]) throw new ApiError('NOT_FOUND');
    const siteScope = new Scope(user, [input.siteId]);
    const site = await c.query(`SELECT s.id FROM sites s WHERE s.id = $1 AND ${siteScope.sites('s')}`, siteScope.params);
    if (!site.rows[0]) throw new ApiError('NOT_FOUND');
    const start = new Date(input.startedAt);
    const end = input.endedAt ? new Date(input.endedAt) : null;
    if (end && end < start) throw new ApiError('TIME_ORDER');
    await assertNoOverlap(c, input.userId, start, end, null);
    let ins;
    try {
      ins = await c.query(
        `INSERT INTO work_sessions (company_id, user_id, site_id, client_id, started_at, ended_at, verification, source)
         VALUES ($1, $2, $3, gen_random_uuid(), $4, $5, 'manual', 'admin') RETURNING id`,
        [user.companyId, input.userId, input.siteId, start, end],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ApiError('ALREADY_CLOCKED_IN');
      throw err;
    }
    const id = ins.rows[0].id as string;
    const after = await snapshot(c, id);
    await c.query(
      'INSERT INTO time_corrections (session_id, changed_by, reason, before, after) VALUES ($1, $2, $3, NULL, $4)',
      [id, user.id, input.reason.trim(), after],
    );
    return id;
  };
  return client ? run(client) : tx(db, run);
}

export async function listCorrections(db: Db, sessionId: string): Promise<CorrectionDto[]> {
  const { rows } = await db.query(
    `SELECT tc.*, u.first_name || ' ' || u.last_name AS changed_by_name
       FROM time_corrections tc JOIN users u ON u.id = tc.changed_by
      WHERE tc.session_id = $1 ORDER BY tc.created_at`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    changedBy: r.changed_by,
    changedByName: r.changed_by_name,
    reason: r.reason,
    before: r.before,
    after: r.after,
    createdAt: r.created_at.toISOString(),
  }));
}
