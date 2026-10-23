import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, DEMO, fixAt, randomUUID, setupTestApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let maxToken: string;
let hafen: TestCtx['ids']['sites'][string];

beforeAll(async () => {
  ctx = await setupTestApp();
  maxToken = await ctx.token(DEMO.max);
  hafen = ctx.ids.sites['Neubau Rheinauhafen'];
});
afterAll(() => ctx.close());

const clockIn = (body: Record<string, unknown>, token = maxToken) =>
  ctx.app.inject({ method: 'POST', url: '/api/me/time/clock-in', headers: auth(token), payload: body });
const post = (url: string, body: Record<string, unknown> = {}, token = maxToken) =>
  ctx.app.inject({ method: 'POST', url, headers: auth(token), payload: { clientId: randomUUID(), ...body } });

describe('Standortprüfung beim Einstempeln (serverseitig)', () => {
  it('lehnt 500,5 m ab (OUTSIDE_RADIUS) und nennt den Abstand', async () => {
    const res = await clockIn({ clientId: randomUUID(), siteId: hafen.id, location: fixAt(hafen, 500.5) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OUTSIDE_RADIUS');
    expect(res.json().error.details.distanceM).toBeCloseTo(500.5, 0);
  });

  it('lehnt ungenaue Standorte ab (101 m Genauigkeit)', async () => {
    const res = await clockIn({ clientId: randomUUID(), siteId: hafen.id, location: fixAt(hafen, 10, 101) });
    expect(res.json().error.code).toBe('LOCATION_INACCURATE');
  });

  it('lehnt veraltete und fehlende Standorte ab', async () => {
    const old = fixAt(hafen, 10, 10, new Date(Date.now() - 5 * 60_000));
    expect((await clockIn({ clientId: randomUUID(), siteId: hafen.id, location: old })).json().error.code).toBe('LOCATION_STALE');
    expect((await clockIn({ clientId: randomUUID(), siteId: hafen.id })).json().error.code).toBe('LOCATION_MISSING');
  });

  it('lehnt nicht zugewiesene Baustellen ab', async () => {
    const bonn = ctx.ids.sites['Dachsanierung Bonn'];
    const res = await clockIn({ clientId: randomUUID(), siteId: bonn.id, location: fixAt(bonn, 0) });
    expect(res.json().error.code).toBe('NOT_ASSIGNED');
  });

  it('verlangt eine Anmeldung', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/me/time/clock-in', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('stempelt bei 499,5 m regulär ein (serverbestätigt, Serverzeit)', async () => {
    const deviceTime = new Date(Date.now() - 3 * 3600_000).toISOString(); // falsche Geräteuhr
    const res = await clockIn({ clientId: randomUUID(), siteId: hafen.id, deviceTime, location: fixAt(hafen, 499.5) });
    expect(res.statusCode).toBe(200);
    const s = res.json().session;
    expect(s.verification).toBe('verified');
    expect(s.source).toBe('online');
    expect(Math.abs(Date.parse(s.startedAt) - Date.now())).toBeLessThan(5000); // Serverzeit, nicht Gerätezeit
    expect(s.startLocation.distanceM).toBeCloseTo(499.5, 0);
  });
});

describe('Doppelte Buchungen und parallele Sitzungen', () => {
  it('verhindert eine zweite offene Sitzung', async () => {
    const res = await clockIn({ clientId: randomUUID(), siteId: hafen.id, location: fixAt(hafen, 5) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ALREADY_CLOCKED_IN');
  });

  it('Pause → Pause doppelt → Fortsetzen → Ausstempeln außerhalb des Radius', async () => {
    const p1 = await post('/api/me/time/pause');
    expect(p1.statusCode).toBe(200);
    expect((await post('/api/me/time/pause')).json().error.code).toBe('ALREADY_ON_BREAK');
    expect((await post('/api/me/time/resume')).statusCode).toBe(200);
    expect((await post('/api/me/time/resume')).json().error.code).toBe('NOT_ON_BREAK');
    const out = await post('/api/me/time/clock-out', { location: fixAt(hafen, 25_000, 30) });
    expect(out.statusCode).toBe(200);
    const s = out.json().session;
    expect(s.endedAt).not.toBeNull();
    expect(s.breaks).toHaveLength(1);
    expect(s.endDistanceM).toBeGreaterThan(24_000);
    expect(s.totals.netMs).toBe(s.totals.grossMs - s.totals.breakMs);
    expect((await post('/api/me/time/clock-out')).json().error.code).toBe('NOT_CLOCKED_IN');
  });

  it('Wiederholung mit derselben clientId ist idempotent', async () => {
    const clientId = randomUUID();
    const body = { clientId, siteId: hafen.id, location: fixAt(hafen, 5) };
    const a = await clockIn(body);
    const b = await clockIn(body);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json().duplicate).toBe(true);
    expect(b.json().session.id).toBe(a.json().session.id);

    const outId = randomUUID();
    const o1 = await post('/api/me/time/clock-out', { clientId: outId });
    const o2 = await post('/api/me/time/clock-out', { clientId: outId });
    expect(o1.statusCode).toBe(200);
    expect(o2.json().duplicate).toBe(true);
    expect(o2.json().session.endedAt).toBe(o1.json().session.endedAt);
  });

  it('gleichzeitige Einstempel-Anfragen erzeugen genau eine Sitzung', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => clockIn({ clientId: randomUUID(), siteId: hafen.id, location: fixAt(hafen, 5) })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === 'ALREADY_CLOCKED_IN')).toBe(true);
    const open = await ctx.db.query('SELECT count(*)::int AS n FROM work_sessions WHERE user_id = $1 AND ended_at IS NULL', [
      ctx.ids.users[DEMO.max],
    ]);
    expect(open.rows[0].n).toBe(1);
    await post('/api/me/time/clock-out');
  });

  it('gleichzeitige Pausen-Anfragen erzeugen genau eine Pause', async () => {
    await clockIn({ clientId: randomUUID(), siteId: hafen.id, location: fixAt(hafen, 5) });
    const results = await Promise.all(Array.from({ length: 5 }, () => post('/api/me/time/pause')));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const cur = await ctx.app.inject({ method: 'GET', url: '/api/me/time/current', headers: auth(maxToken) });
    expect(cur.json().session.breaks).toHaveLength(1);
    expect(cur.json().session.breaks[0].endedAt).toBeNull();
    // Ausstempeln während der Pause beendet die Pause automatisch.
    const out = await post('/api/me/time/clock-out');
    expect(out.json().session.breaks[0].endedAt).toBe(out.json().session.endedAt);
  });
});
