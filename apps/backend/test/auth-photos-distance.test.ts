import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, DEMO, DEMO_PASSWORD, fakeJpeg, multipart, randomUUID, setupTestApp, type TestCtx } from './helpers.js';
import { DEMO_INVITE_CODE } from '../src/db/seed.js';
import type { RoutingProvider } from '../src/services/routing.js';

let ctx: TestCtx;
const calls: unknown[] = [];
const fakeRouting: RoutingProvider = {
  name: 'test-router',
  async route(from, to) {
    calls.push([from, to]);
    return { distanceM: 12_345, durationS: 900, provider: 'test-router', simulated: false };
  },
};

beforeAll(async () => {
  ctx = await setupTestApp({ routing: fakeRouting, env: { MAX_UPLOAD_MB: '0.05' } });
});
afterAll(() => ctx.close());

const login = (payload: object, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload, headers });

describe('Anmeldung', () => {
  it('lehnt falsche Passwörter und unbekannte Benutzer gleich ab', async () => {
    expect((await login({ email: DEMO.max, password: 'falsch' })).json().error.code).toBe('INVALID_CREDENTIALS');
    expect((await login({ email: 'gibtsnicht@example.com', password: 'falsch' })).json().error.code).toBe('INVALID_CREDENTIALS');
    // Eingeladene Konten ohne Passwort können sich nicht anmelden.
    expect((await login({ email: DEMO.invited, password: '' })).statusCode).toBe(400);
  });

  it('Refresh-Token wird rotiert; Wiederverwendung sperrt alle Sitzungen', async () => {
    const first = (await login({ email: DEMO.max, password: DEMO_PASSWORD })).json();
    const r1 = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json().refreshToken;
    expect(second).not.toBe(first.refreshToken);
    const reuse = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: second } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('Web-Client erhält das Refresh-Token nur als httpOnly-Cookie', async () => {
    const res = await login({ email: DEMO.admin, password: DEMO_PASSWORD }, { 'x-client': 'web' });
    expect(res.json().refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const refresh = await ctx.app.inject({
      method: 'POST', url: '/api/auth/refresh', headers: { 'x-client': 'web', cookie: cookie.split(';')[0] }, payload: {},
    });
    expect(refresh.statusCode).toBe(200);
  });

  it('Einladung annehmen mit Demo-Code', async () => {
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/auth/accept-invite',
      payload: { email: DEMO.invited, code: DEMO_INVITE_CODE, password: 'kurz' },
    });
    expect(res.statusCode).toBe(400);
    const ok = await ctx.app.inject({
      method: 'POST', url: '/api/auth/accept-invite',
      payload: { email: DEMO.invited, code: DEMO_INVITE_CODE, password: 'NeuesPasswort123' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.invitePending).toBe(false);
  });
});

describe('Foto-Uploads', () => {
  it('prüft Dateisignatur, Größe und Duplikate', async () => {
    const t = await ctx.token(DEMO.max);
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const reportClientId = randomUUID();
    await ctx.app.inject({
      method: 'POST', url: '/api/me/reports', headers: auth(t),
      payload: { clientId: reportClientId, siteId: hafen.id, reportDate: new Date().toISOString().slice(0, 10), workDone: 'Test' },
    });
    const upload = (data: Buffer, clientId = randomUUID(), type = 'image/jpeg') => {
      const mp = multipart({ clientId, reportClientId }, { name: 'x.jpg', type, data });
      return ctx.app.inject({ method: 'POST', url: '/api/me/photos', headers: { ...auth(t), ...mp.headers }, payload: mp.payload });
    };
    const fake = await upload(Buffer.from('<?php echo "kein Bild"; ?>          '), randomUUID(), 'image/jpeg');
    expect(fake.json().error.code).toBe('UPLOAD_INVALID');
    expect((await upload(fakeJpeg(80 * 1024))).statusCode).toBe(413);
    const id = randomUUID();
    const a = await upload(fakeJpeg(), id);
    const b = await upload(fakeJpeg(), id);
    expect(a.statusCode).toBe(200);
    expect(b.json().duplicate).toBe(true);
    expect(b.json().photo.id).toBe(a.json().photo.id);
    const file = await ctx.app.inject({ method: 'GET', url: a.json().photo.url, headers: auth(t) });
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

describe('Entfernung Wohnort → Baustelle (austauschbare Routing-Schnittstelle)', () => {
  it('nutzt den konfigurierten Anbieter, kennzeichnet einfache Strecke und speichert zwischen', async () => {
    const t = await ctx.token(DEMO.max);
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const res = await ctx.app.inject({ method: 'GET', url: `/api/me/sites/${hafen.id}/distance`, headers: auth(t) });
    expect(res.statusCode).toBe(200);
    expect(res.json().distance).toMatchObject({ distanceM: 12_345, oneWay: true, simulated: false, provider: 'test-router' });
    await ctx.app.inject({ method: 'GET', url: `/api/me/sites/${hafen.id}/distance`, headers: auth(t) });
    expect(calls).toHaveLength(1);
  });

  it('meldet fehlenden Wohnort und verweigert fremde Baustellen', async () => {
    const nina = await login({ email: DEMO.invited, password: 'NeuesPasswort123' });
    const t = nina.json().accessToken;
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const res = await ctx.app.inject({ method: 'GET', url: `/api/me/sites/${hafen.id}/distance`, headers: auth(t) });
    expect(res.json().error.code).toBe('HOME_ADDRESS_MISSING');
    const bonn = ctx.ids.sites['Dachsanierung Bonn'];
    const max = await ctx.token(DEMO.max);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/me/sites/${bonn.id}/distance`, headers: auth(max) })).statusCode).toBe(404);
  });
});

describe('Unbekannte Pfade', () => {
  it('liefert für unbekannte API-Pfade das einheitliche Fehlerformat', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
