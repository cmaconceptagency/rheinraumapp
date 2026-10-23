import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, DEMO, randomUUID, setupTestApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let adminT: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  adminT = await ctx.token(DEMO.admin);
});
afterAll(() => ctx.close());

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, token = adminT) =>
  ctx.app.inject({ method, url, headers: auth(token), ...(payload ? { payload: payload as object } : {}) });

describe('Zeitkorrekturen mit unveränderbarer Historie', () => {
  it('verlangt eine Begründung', async () => {
    const s = await ctx.db.query('SELECT id FROM work_sessions WHERE user_id = $1 LIMIT 1', [ctx.ids.users[DEMO.max]]);
    const res = await call('POST', `/api/admin/sessions/${s.rows[0].id}/corrections`, { endedAt: new Date().toISOString() });
    expect(res.statusCode).toBe(400);
  });

  it('korrigiert Zeiten, protokolliert vorher/nachher und kennzeichnet als korrigiert', async () => {
    const s = await ctx.db.query('SELECT id, started_at, ended_at FROM work_sessions WHERE user_id = $1 AND ended_at IS NOT NULL LIMIT 1', [
      ctx.ids.users[DEMO.max],
    ]);
    const row = s.rows[0];
    const newEnd = new Date(row.ended_at.getTime() - 15 * 60_000).toISOString();
    const res = await call('POST', `/api/admin/sessions/${row.id}/corrections`, { reason: 'Feierabend laut Bautagebuch früher', endedAt: newEnd });
    expect(res.statusCode).toBe(200);
    expect(res.json().session.verification).toBe('corrected');
    expect(res.json().session.endedAt).toBe(newEnd);
    const [c] = res.json().corrections;
    expect(c.before.endedAt).toBe(row.ended_at.toISOString());
    expect(c.after.endedAt).toBe(newEnd);
    expect(c.changedByName).toBe('Anna Admin');
  });

  it('die Änderungshistorie kann in der Datenbank nicht verändert oder gelöscht werden', async () => {
    await expect(ctx.db.query(`UPDATE time_corrections SET reason = 'manipuliert'`)).rejects.toThrow(/unveränderbar/);
    await expect(ctx.db.query('DELETE FROM time_corrections')).rejects.toThrow(/unveränderbar/);
    await expect(ctx.db.query('TRUNCATE time_corrections')).rejects.toThrow(/unveränderbar/);
  });

  it('Prüfen einer ungeprüften Buchung behält die Kennzeichnung bei', async () => {
    const s = await ctx.db.query(`SELECT id FROM work_sessions WHERE verification = 'unverified' LIMIT 1`);
    const res = await call('POST', `/api/admin/sessions/${s.rows[0].id}/review`, { reason: 'Mit Bautagebuch abgeglichen' });
    expect(res.json().session.verification).toBe('unverified');
    expect(res.json().session.reviewedByName).toBe('Anna Admin');
  });
});

describe('Korrekturanfragen', () => {
  it('Mitarbeiter stellt begründete Anfrage, Admin genehmigt → manuelle Sitzung', async () => {
    const maxT = await ctx.token(DEMO.max);
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const start = new Date();
    start.setUTCHours(start.getUTCHours() - 1, 0, 0, 0);
    const create = await call(
      'POST',
      '/api/me/correction-requests',
      { clientId: randomUUID(), siteId: hafen.id, requestedStart: start.toISOString(), reason: 'Standort ließ sich nicht ermitteln (Keller).' },
      maxT,
    );
    expect(create.statusCode).toBe(200);
    expect((await call('POST', '/api/me/correction-requests', { clientId: randomUUID(), siteId: hafen.id, requestedStart: start.toISOString(), reason: 'kurz' }, maxT)).statusCode).toBe(400);

    const id = create.json().request.id;
    const ok = await call('POST', `/api/admin/correction-requests/${id}/approve`, {});
    expect(ok.statusCode).toBe(200);
    const cur = await call('GET', '/api/me/time/current', undefined, maxT);
    expect(cur.json().session.verification).toBe('manual');
    expect(cur.json().session.startedAt).toBe(start.toISOString());
    expect((await call('POST', `/api/admin/correction-requests/${id}/approve`, {})).statusCode).toBe(400);
  });
});

describe('Verwaltung', () => {
  it('legt Mitarbeiter mit Einladungscode an, der zur Anmeldung genutzt werden kann', async () => {
    const res = await call('POST', '/api/admin/users', { email: 'paul@musterbau.example', firstName: 'Paul', lastName: 'Probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.invitePending).toBe(true);
    const code = res.json().invite.code;
    const accept = await ctx.app.inject({
      method: 'POST', url: '/api/auth/accept-invite',
      payload: { email: 'paul@musterbau.example', code: code.toLowerCase(), password: 'SicheresPasswort1' },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().refreshToken).toBeTruthy();
    const again = await ctx.app.inject({
      method: 'POST', url: '/api/auth/accept-invite',
      payload: { email: 'paul@musterbau.example', code, password: 'SicheresPasswort1' },
    });
    expect(again.json().error.code).toBe('INVITE_INVALID');
  });

  it('beachtet die Lizenzanzahl', async () => {
    await ctx.db.query('UPDATE companies SET licensed_seats = (SELECT count(*) FROM users WHERE active)');
    const res = await call('POST', '/api/admin/users', { email: 'zuviel@musterbau.example', firstName: 'Z', lastName: 'V' });
    expect(res.json().error.code).toBe('SEAT_LIMIT');
    await ctx.db.query('UPDATE companies SET licensed_seats = 100');
  });

  it('deaktivierte Mitarbeiter können sich nicht mehr anmelden', async () => {
    const id = ctx.ids.users[DEMO.erika];
    const erikaT = await ctx.token(DEMO.erika);
    expect((await call('PATCH', `/api/admin/users/${id}`, { active: false })).statusCode).toBe(200);
    expect((await call('GET', '/api/me', undefined, erikaT)).statusCode).toBe(401);
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: DEMO.erika, password: 'Baustelle2026!' } });
    expect(login.json().error.code).toBe('ACCOUNT_INACTIVE');
    await call('PATCH', `/api/admin/users/${id}`, { active: true });
  });

  it('Baustelle mit Standardradius 500 m anlegen und Mitarbeiter zeitlich zuweisen', async () => {
    const site = await call('POST', '/api/admin/sites', { name: 'Test', street: 'Weg 1', zip: '50667', city: 'Köln', lat: 50.94, lng: 6.95 });
    expect(site.json().site.radiusM).toBe(500);
    const a = await call('POST', '/api/admin/assignments', { siteId: site.json().site.id, userId: ctx.ids.users[DEMO.max], validFrom: '2030-01-10', validTo: '2030-01-01' });
    expect(a.json().error.code).toBe('TIME_ORDER');
  });

  it('CSV-Export: deutsches Format, nur sichtbare Daten', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const prev = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 7);
    const res = await call('GET', `/api/admin/export/time.csv?month=${month}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('﻿Personalnr.;Mitarbeiter;Datum')).toBe(true);
    const both = res.body + (await call('GET', `/api/admin/export/time.csv?month=${prev}`)).body;
    expect(both).toContain('Max Mustermann');
    expect(both).toMatch(/;8,25;|;8;|;\d+,\d+;/);
    const mgr = await call('GET', `/api/admin/export/time.csv?month=${month}`, undefined, await ctx.token(DEMO.manager));
    expect(mgr.body).not.toContain('Erika');
    expect((await call('GET', '/api/admin/export/time.csv?month=2026-13')).statusCode).toBe(400);
  });
});
