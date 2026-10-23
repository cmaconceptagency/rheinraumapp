// Web: In der Browser-Demo wird der Standort SIMULIERT (Auswahl im Demo-Bedienfeld neben der App).
// Ohne Demo wird die Browser-Geolocation verwendet.
import { offsetNorth } from '@rheinraum/shared';
import type { LocationPayload } from '../sync/queue';

export type LocationProblem = 'PERMISSION_DENIED' | 'PERMISSION_BLOCKED' | 'SERVICES_OFF' | 'TIMEOUT' | 'UNAVAILABLE';
export type LocationResult = { ok: true; fix: LocationPayload } | { ok: false; problem: LocationProblem };

export const LOCATION_PROBLEM_TEXT: Record<LocationProblem, string> = {
  PERMISSION_DENIED: 'Für das Einstempeln wird einmalig Ihr aktueller Standort benötigt. Bitte erlauben Sie den Standortzugriff.',
  PERMISSION_BLOCKED: 'Der Standortzugriff ist in den Einstellungen deaktiviert. Bitte dort „Beim Verwenden der App“ erlauben.',
  SERVICES_OFF: 'Die Ortungsdienste des Telefons sind ausgeschaltet. Bitte einschalten und erneut prüfen.',
  TIMEOUT: 'Der Standort konnte nicht rechtzeitig ermittelt werden. Bitte ins Freie gehen und erneut prüfen.',
  UNAVAILABLE: 'Der Standort ist derzeit nicht verfügbar. Bitte erneut prüfen.',
};

export const openSettings = () => undefined;

type DemoGps = 'at_site' | 'edge' | 'outside' | 'inaccurate' | 'denied' | 'off';
let lastTarget: { lat: number; lng: number; radiusM: number } | null = null;

export async function getCurrentFix(timeoutMs = 20_000, target?: { lat: number; lng: number; radiusM: number }): Promise<LocationResult> {
  const demo = (globalThis as { __rrDemo?: { gps: DemoGps } }).__rrDemo;
  if (target) lastTarget = target;
  if (demo) {
    await new Promise((r) => setTimeout(r, 700));
    const t = target ?? lastTarget ?? { lat: 50.93, lng: 6.96, radiusM: 500 };
    const at = (m: number, accuracy: number): LocationResult => ({
      ok: true,
      fix: { ...offsetNorth(t, m), accuracy, capturedAt: new Date().toISOString() },
    });
    switch (demo.gps) {
      case 'at_site':
        return at(40, 12);
      case 'edge':
        return at(t.radiusM - 3, 15);
      case 'outside':
        return at(t.radiusM + 150, 12);
      case 'inaccurate':
        return at(30, 250);
      case 'denied':
        return { ok: false, problem: 'PERMISSION_DENIED' };
      case 'off':
        return { ok: false, problem: 'SERVICES_OFF' };
    }
  }
  if (!('geolocation' in navigator)) return { ok: false, problem: 'UNAVAILABLE' };
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: new Date(pos.timestamp).toISOString() },
        }),
      (err) => resolve({ ok: false, problem: err.code === 1 ? 'PERMISSION_DENIED' : err.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    ),
  );
}
