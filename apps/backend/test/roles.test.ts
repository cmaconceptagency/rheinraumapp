import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, DEMO, fakeJpeg, multipart, randomUUID, setupTestApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
const today = new Date().toISOString().slice(0, 10);
const range = `from=2000-01-01&to=2100-01-01`;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());

const get = async (url: string, email: string) => ctx.app.inject({ method: 'GET', url, headers: auth(await ctx.token(email)) });

describe('Rollenrechte', () => {
  it('Mitarbeiter haben keinen Zugriff auf die Administration', async () => {
    for (const url of ['/api/admin/overview', '/api/admin/users', `/api/admin/sessions?${range}`, '/api/admin/sick-notes']) {
      expect((await get(url, DEMO.max)).statusCode).toBe(403);
    }
  });

  it('Bauleiter sehen nur Arbeitszeiten ihrer Teams und Baustellen', async () => {
    const res = await get(`/api/admin/sessions?${range}`, DEMO.manager);
    expect(res.statusCode).toBe(200);
    const names = new Set(res.json().sessions.map((s: { userName: string }) => s.userName));
    expect(names.has('Max Mustermann')).toBe(true);
    expect(names.has('Erika Musterfrau')).toBe(false);

    const admin = await get(`/api/admin/sessions?${range}`, DEMO.admin);
    const all = new Set(admin.json().sessions.map((s: { userName: string }) => s.userName));
    expect(all.has('Erika Musterfrau')).toBe(true);
  });

  it('Bauleiter sehen nur zugewiesene Baustellen und Mitarbeiter', async () => {
    const sites = (await get('/api/admin/sites', DEMO.manager)).json().sites.map((s: { name: string }) => s.name);
    expect(sites.sort()).toEqual(['Altbausanierung Deutz', 'Neubau Rheinauhafen']);
    const users = (await get('/api/admin/users', DEMO.manager)).json().users.map((u: { email: string }) => u.email);
    expect(users).toContain(DEMO.max);
    expect(users).not.toContain(DEMO.erika);
  });

  it('Bauleiter dürfen keine Mitarbeiter/Baustellen anlegen und keine fremden Sitzungen öffnen', async () => {
    const t = await ctx.token(DEMO.manager);
    const u = await ctx.app.inject({
      method: 'POST', url: '/api/admin/users', headers: auth(t),
      payload: { email: 'x@example.com', firstName: 'X', lastName: 'Y' },
    });
    expect(u.statusCode).toBe(403);
    const erikaSession = await ctx.db.query('SELECT id FROM work_sessions WHERE user_id = $1 LIMIT 1', [ctx.ids.users[DEMO.erika]]);
    expect((await get(`/api/admin/sessions/${erikaSession.rows[0].id}`, DEMO.manager)).statusCode).toBe(404);
    const corr = await ctx.app.inject({
      method: 'POST', url: `/api/admin/sessions/${erikaSession.rows[0].id}/corrections`, headers: auth(t),
      payload: { reason: 'Unberechtigter Versuch' },
    });
    expect(corr.statusCode).toBe(404);
  });

  it('Krankmeldungen und Wohnadressen nur mit HR-Berechtigung', async () => {
    const maxId = ctx.ids.users[DEMO.max];
    for (const email of [DEMO.manager, DEMO.office]) {
      expect((await get('/api/admin/sick-notes', email)).statusCode).toBe(403);
      expect((await get(`/api/admin/users/${maxId}/home`, email)).statusCode).toBe(403);
    }
    const sick = await get('/api/admin/sick-notes', DEMO.admin);
    expect(sick.statusCode).toBe(200);
    expect(sick.json().sickNotes).toHaveLength(1);
    expect(Object.keys(sick.json().sickNotes[0])).not.toContain('diagnosis');
    const home = await get(`/api/admin/users/${maxId}/home`, DEMO.admin);
    expect(home.json().home.city).toBe('Köln');
  });

  it('Krankmeldung akzeptiert kein Diagnosefeld', async () => {
    const t = await ctx.token(DEMO.max);
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/me/sick-notes', headers: auth(t),
      payload: { clientId: randomUUID(), startDate: today, expectedEndDate: today, diagnosis: 'Grippe' },
    });
    expect(res.statusCode).toBe(400);
    const ok = await ctx.app.inject({
      method: 'POST', url: '/api/me/sick-notes', headers: auth(t),
      payload: { clientId: randomUUID(), startDate: today, expectedEndDate: today },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('Nur HR-berechtigte Admins dürfen HR-Rechte vergeben', async () => {
    const t = await ctx.token(DEMO.office);
    const res = await ctx.app.inject({
      method: 'PATCH', url: `/api/admin/users/${ctx.ids.users[DEMO.office]}`, headers: auth(t), payload: { hrAccess: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Fotos: Ersteller, zuständiger Bauleiter und Admin dürfen lesen, andere nicht', async () => {
    const maxT = await ctx.token(DEMO.max);
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const reportClientId = randomUUID();
    const rep = await ctx.app.inject({
      method: 'POST', url: '/api/me/reports', headers: auth(maxT),
      payload: { clientId: reportClientId, siteId: hafen.id, reportDate: today, workDone: 'Estrich verlegt' },
    });
    expect(rep.statusCode).toBe(200);
    const mp = multipart({ clientId: randomUUID(), reportClientId }, { name: 'a.jpg', type: 'image/jpeg', data: fakeJpeg() });
    const up = await ctx.app.inject({ method: 'POST', url: '/api/me/photos', headers: { ...auth(maxT), ...mp.headers }, payload: mp.payload });
    expect(up.statusCode).toBe(200);
    const url = up.json().photo.url;
    expect((await get(url, DEMO.max)).statusCode).toBe(200);
    expect((await get(url, DEMO.manager)).statusCode).toBe(200);
    expect((await get(url, DEMO.admin)).statusCode).toBe(200);
    expect((await get(url, DEMO.erika)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });

  it('Mandantentrennung: Benutzer einer anderen Firma sehen nichts', async () => {
    const c = await ctx.db.query(`INSERT INTO companies (name) VALUES ('Andere Firma') RETURNING id`);
    const hash = (await ctx.db.query('SELECT password_hash FROM users WHERE email = $1', [DEMO.admin])).rows[0].password_hash;
    await ctx.db.query(
      `INSERT INTO users (company_id, email, password_hash, first_name, last_name, role) VALUES ($1, 'fremd@example.com', $2, 'F', 'A', 'admin')`,
      [c.rows[0].id, hash],
    );
    const res = await get(`/api/admin/sessions?${range}`, 'fremd@example.com');
    expect(res.json().sessions).toHaveLength(0);
    expect((await get('/api/admin/users', 'fremd@example.com')).json().users).toHaveLength(1);
    const maxSession = await ctx.db.query('SELECT id FROM work_sessions WHERE user_id = $1 LIMIT 1', [ctx.ids.users[DEMO.max]]);
    expect((await get(`/api/admin/sessions/${maxSession.rows[0].id}`, 'fremd@example.com')).statusCode).toBe(404);
  });
});
