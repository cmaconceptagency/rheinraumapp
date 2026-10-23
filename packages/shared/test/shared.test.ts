import { describe, expect, it } from 'vitest';
import {
  breakHint,
  computeSessionTotals,
  evaluateLocation,
  formatDuration,
  haversineMeters,
  offsetNorth,
} from '../src/index';

const site = { lat: 50.9375, lng: 6.9603 };
const rules = { radiusM: 500, maxAccuracyM: 100, maxAgeS: 120 };
const now = new Date('2026-05-04T07:00:00Z');
const fix = (meters: number, accuracy = 10, capturedAt = now.toISOString()) => ({
  ...offsetNorth(site, meters),
  accuracy,
  capturedAt,
});

describe('evaluateLocation – 500-Meter-Grenzfall', () => {
  it('offsetNorth erzeugt die gewünschte Entfernung', () => {
    expect(haversineMeters(site, offsetNorth(site, 500))).toBeCloseTo(500, 3);
  });
  it('499 m und exakt 500 m sind innerhalb', () => {
    expect(evaluateLocation(fix(499), site, rules, now).code).toBe('OK');
    expect(evaluateLocation(fix(500), site, rules, now).ok).toBe(true);
  });
  it('500,5 m und 501 m sind außerhalb', () => {
    expect(evaluateLocation(fix(500.5), site, rules, now).code).toBe('OUTSIDE_RADIUS');
    expect(evaluateLocation(fix(501), site, rules, now).code).toBe('OUTSIDE_RADIUS');
  });
  it('lehnt ungenaue, veraltete, fehlende und ungültige Standorte ab', () => {
    expect(evaluateLocation(fix(10, 101), site, rules, now).code).toBe('LOCATION_INACCURATE');
    expect(evaluateLocation(fix(10, 100), site, rules, now).code).toBe('OK');
    const old = new Date(now.getTime() - 121_000).toISOString();
    expect(evaluateLocation(fix(10, 10, old), site, rules, now).code).toBe('LOCATION_STALE');
    const future = new Date(now.getTime() + 60_000).toISOString();
    expect(evaluateLocation(fix(10, 10, future), site, rules, now).code).toBe('LOCATION_STALE');
    expect(evaluateLocation(null, site, rules, now).code).toBe('LOCATION_MISSING');
    expect(evaluateLocation({ lat: 200, lng: 0, accuracy: 5, capturedAt: now.toISOString() }, site, rules, now).code).toBe(
      'LOCATION_INVALID',
    );
  });
  it('Genauigkeit wird nicht auf den Abstand angerechnet', () => {
    expect(evaluateLocation(fix(550, 80), site, rules, now).code).toBe('OUTSIDE_RADIUS');
  });
});

describe('computeSessionTotals – Pausenberechnung', () => {
  const s = { startedAt: '2026-05-04T06:00:00Z', endedAt: '2026-05-04T15:00:00Z' };
  it('zieht Pausen ab', () => {
    const t = computeSessionTotals(s, [
      { startedAt: '2026-05-04T09:00:00Z', endedAt: '2026-05-04T09:15:00Z' },
      { startedAt: '2026-05-04T12:00:00Z', endedAt: '2026-05-04T12:30:00Z' },
    ]);
    expect(t.grossMs).toBe(9 * 3600_000);
    expect(t.breakMs).toBe(45 * 60_000);
    expect(formatDuration(t.netMs)).toBe('8:15');
  });
  it('zählt überlappende Pausen nur einmal und begrenzt auf die Sitzung', () => {
    const t = computeSessionTotals(s, [
      { startedAt: '2026-05-04T05:30:00Z', endedAt: '2026-05-04T06:10:00Z' },
      { startedAt: '2026-05-04T12:00:00Z', endedAt: '2026-05-04T12:30:00Z' },
      { startedAt: '2026-05-04T12:20:00Z', endedAt: '2026-05-04T12:40:00Z' },
    ]);
    expect(t.breakMs).toBe(50 * 60_000);
  });
  it('rechnet offene Sitzung und offene Pause bis jetzt', () => {
    const t = computeSessionTotals(
      { startedAt: '2026-05-04T06:00:00Z', endedAt: null },
      [{ startedAt: '2026-05-04T08:00:00Z', endedAt: null }],
      new Date('2026-05-04T08:20:00Z'),
    );
    expect(t.grossMs).toBe(140 * 60_000);
    expect(t.breakMs).toBe(20 * 60_000);
    expect(t.netMs).toBe(120 * 60_000);
  });
  it('gibt Hinweise nach ArbZG', () => {
    expect(breakHint({ grossMs: 0, netMs: 6.5 * 3600_000, breakMs: 15 * 60_000 })).toMatch(/30 Min/);
    expect(breakHint({ grossMs: 0, netMs: 9.5 * 3600_000, breakMs: 30 * 60_000 })).toMatch(/45 Min/);
    expect(breakHint({ grossMs: 0, netMs: 6.5 * 3600_000, breakMs: 30 * 60_000 })).toBeNull();
  });
});
