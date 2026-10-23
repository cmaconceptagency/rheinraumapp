import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, DEMO, fixAt, randomUUID, setupTestApp, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let token: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  token = await ctx.token(DEMO.max);
});
afterAll(() => ctx.close());

const sync = (ops: unknown[]) =>
  ctx.app.inject({ method: 'POST', url: '/api/me/time/sync', headers: auth(token), payload: { ops } });
// Fester Bezugszeitpunkt je Testfall, damit Dauern exakt vergleichbar sind.
let base = Date.now();
const ago = (min: number) => new Date(base - min * 60_000).toISOString();
beforeEach(() => {
  base = Date.now();
});

describe('Offline-Synchronisation', () => {
  const hafenOps = () => {
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    return [
      { type: 'clock_in', clientId: randomUUID(), siteId: hafen.id, deviceTime: ago(240), location: fixAt(hafen, 20, 15, new Date(base - 240 * 60_000)) },
      { type: 'break_start', clientId: randomUUID(), deviceTime: ago(120) },
      { type: 'break_end', clientId: randomUUID(), deviceTime: ago(90) },
      { type: 'clock_out', clientId: randomUUID(), deviceTime: ago(10) },
    ];
  };
  let ops: ReturnType<typeof hafenOps>;

  it('übernimmt Offline-Buchungen mit Gerätezeit und kennzeichnet sie als ungeprüft', async () => {
    ops = hafenOps();
    const res = await sync(ops);
    expect(res.statusCode).toBe(200);
    const results = res.json().results;
    expect(results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
    const s = results[3].session;
    expect(s.verification).toBe('unverified');
    expect(s.source).toBe('offline');
    expect(s.startedAt).toBe(ops[0].deviceTime);
    expect(s.endedAt).toBe(ops[3].deviceTime);
    expect(s.totals.breakMs).toBe(30 * 60_000);
    expect(s.totals.netMs).toBe((230 - 30) * 60_000);
    // Das Prüfergebnis wird nur protokolliert, keine vorgetäuschte Serverprüfung.
    expect(s.startLocation.offline).toBe(true);
  });

  it('erneutes Senden derselben Buchungen erzeugt keine Duplikate', async () => {
    const res = await sync(ops);
    expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate']);
    const count = await ctx.db.query('SELECT count(*)::int AS n FROM work_sessions WHERE client_id = $1', [ops[0].clientId]);
    expect(count.rows[0].n).toBe(1);
    const breaks = await ctx.db.query(
      'SELECT count(*)::int AS n FROM work_breaks b JOIN work_sessions s ON s.id = b.session_id WHERE s.client_id = $1',
      [ops[0].clientId],
    );
    expect(breaks.rows[0].n).toBe(1);
  });

  it('lehnt Überschneidungen mit bereits erfassten Zeiten ab', async () => {
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const res = await sync([{ type: 'clock_in', clientId: randomUUID(), siteId: hafen.id, deviceTime: ago(60) }]);
    expect(res.json().results[0]).toMatchObject({ status: 'rejected', error: { code: 'ALREADY_CLOCKED_IN' } });
  });

  it('meldet fachliche Konflikte einzeln und verarbeitet die übrigen Buchungen', async () => {
    const bonn = ctx.ids.sites['Dachsanierung Bonn'];
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const res = await sync([
      { type: 'clock_in', clientId: randomUUID(), siteId: bonn.id, deviceTime: ago(5) },
      { type: 'clock_in', clientId: randomUUID(), siteId: hafen.id, deviceTime: ago(4) },
    ]);
    const [a, b] = res.json().results;
    expect(a).toMatchObject({ status: 'rejected', error: { code: 'NOT_ASSIGNED' } });
    expect(b.status).toBe('applied');
    expect(res.json().current.id).toBe(b.session.id);
  });

  it('lehnt Gerätezeiten in der Zukunft ab', async () => {
    const res = await sync([{ type: 'clock_out', clientId: randomUUID(), deviceTime: new Date(Date.now() + 3600_000).toISOString() }]);
    expect(res.json().results[0]).toMatchObject({ status: 'rejected', error: { code: 'TIME_ORDER' } });
  });

  it('eine online angekommene, aber unbestätigte Buchung bleibt beim Nachsenden serverbestätigt', async () => {
    await sync([{ type: 'clock_out', clientId: randomUUID(), deviceTime: ago(1) }]);
    const hafen = ctx.ids.sites['Neubau Rheinauhafen'];
    const clientId = randomUUID();
    const online = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/time/clock-in',
      headers: auth(token),
      payload: { clientId, siteId: hafen.id, location: fixAt(hafen, 5) },
    });
    expect(online.json().session.verification).toBe('verified');
    // App hat die Antwort nicht erhalten und sendet dieselbe Buchung später aus der Warteschlange.
    const res = await sync([{ type: 'clock_in', clientId, siteId: hafen.id, deviceTime: ago(0), location: fixAt(hafen, 5) }]);
    expect(res.json().results[0].status).toBe('duplicate');
    expect(res.json().results[0].session.verification).toBe('verified');
  });

  it('Offline-Pause in einer serverbestätigten Sitzung macht die Sitzung ungeprüft', async () => {
    const res = await sync([{ type: 'break_start', clientId: randomUUID(), deviceTime: ago(0) }]);
    expect(res.json().results[0].session.verification).toBe('unverified');
  });
});
