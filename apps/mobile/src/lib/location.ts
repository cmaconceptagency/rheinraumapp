import * as Location from 'expo-location';
import { Linking } from 'react-native';
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

export const openSettings = () => Linking.openSettings();

/**
 * Fragt EINMALIG den aktuellen Standort ab (nur Vordergrund-Berechtigung, keine dauerhafte Überwachung).
 * Es wird kein zwischengespeicherter "letzter Standort" verwendet.
 */
export async function getCurrentFix(
  timeoutMs = 20_000,
  // Nur von der Browser-Demo genutzt (simulierter Standort relativ zur Baustelle); nativ ohne Bedeutung.
  _target?: { lat: number; lng: number; radiusM: number },
): Promise<LocationResult> {
  let perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    if (!perm.canAskAgain) return { ok: false, problem: 'PERMISSION_BLOCKED' };
    perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, problem: perm.canAskAgain ? 'PERMISSION_DENIED' : 'PERMISSION_BLOCKED' };
  }
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, problem: 'SERVICES_OFF' };

  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!pos) return { ok: false, problem: 'TIMEOUT' };
    return {
      ok: true,
      fix: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        // Unbekannte Genauigkeit wird als sehr ungenau behandelt.
        accuracy: pos.coords.accuracy ?? 99_999,
        capturedAt: new Date(pos.timestamp).toISOString(),
      },
    };
  } catch {
    return { ok: false, problem: 'UNAVAILABLE' };
  }
}
