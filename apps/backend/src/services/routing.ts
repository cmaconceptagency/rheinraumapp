import { haversineMeters, type LatLng } from '@rheinraum/shared';

export interface RouteResult {
  distanceM: number;
  durationS: number | null;
  provider: string;
  /** true = keine echte Straßenberechnung, sondern Näherung (deutlich gekennzeichnet). */
  simulated: boolean;
}

/** Austauschbare Routing-Schnittstelle: berechnet die einfache Straßenstrecke von A nach B. */
export interface RoutingProvider {
  readonly name: string;
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
}

/**
 * SIMULIERT: Luftlinie × 1,3 (typischer Umwegfaktor im Straßennetz) und 50 km/h Durchschnitt.
 * Nur für Entwicklung/Demo – ersetzt keine echte Routenberechnung.
 */
export class SimulatedRoutingProvider implements RoutingProvider {
  readonly name = 'simuliert (Luftlinie × 1,3)';
  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const distanceM = haversineMeters(from, to) * 1.3;
    return { distanceM, durationS: distanceM / (50 / 3.6), provider: this.name, simulated: true };
  }
}

/** OSRM-kompatibler Routing-Dienst (eigener Server empfohlen; der öffentliche Demo-Server ist nicht für Produktion). */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  constructor(
    private baseUrl: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; routes?: { distance: number; duration: number }[] };
    const route = body.routes?.[0];
    if (body.code !== 'Ok' || !route) throw new Error(`OSRM: ${body.code}`);
    return { distanceM: route.distance, durationS: route.duration, provider: this.name, simulated: false };
  }
}

export function createRoutingProvider(kind: 'simulated' | 'osrm', osrmUrl: string): RoutingProvider {
  return kind === 'osrm' ? new OsrmRoutingProvider(osrmUrl) : new SimulatedRoutingProvider();
}
