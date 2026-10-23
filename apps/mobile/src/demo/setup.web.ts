/**
 * Browser-Demo (nur mit EXPO_PUBLIC_DEMO=1): leitet alle API-Aufrufe an den SIMULIERTEN Demo-Server im Browser um
 * und stellt dem Demo-Bedienfeld (GPS-Simulation, Verbindung trennen, Zurücksetzen) eine Schnittstelle bereit.
 */
import NetInfo from '@react-native-community/netinfo';
import { DemoServer } from './mockServer';

const REACHABILITY_PATH = '/__rr-demo-reachability';

type Gps = 'at_site' | 'edge' | 'outside' | 'inaccurate' | 'denied' | 'off';

export interface DemoControl {
  gps: Gps;
  offline: boolean;
  server: DemoServer;
  setGps: (g: Gps) => void;
  setOffline: (v: boolean) => void;
  reset: () => void;
  subscribe: (fn: () => void) => () => void;
}

if (process.env.EXPO_PUBLIC_DEMO === '1' && typeof window !== 'undefined' && !(window as { __rrDemo?: unknown }).__rrDemo) {
  const server = new DemoServer();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  server.subscribe(emit);

  const demo: DemoControl = {
    gps: 'at_site',
    offline: false,
    server,
    setGps: (g) => {
      demo.gps = g;
      emit();
    },
    setOffline: (v) => {
      demo.offline = v;
      // NetInfo (Web) liest navigator.onLine bei online/offline- bzw. navigator.connection-Ereignissen.
      window.dispatchEvent(new Event(v ? 'offline' : 'online'));
      (navigator as Navigator & { connection?: EventTarget }).connection?.dispatchEvent(new Event('change'));
      emit();
    },
    reset: () => {
      server.reset();
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('rr.') || k.startsWith('@')) localStorage.removeItem(k);
        sessionStorage.clear();
      } catch {
        /* ignorieren */
      }
      location.reload();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Erreichbarkeitsprüfung von NetInfo gegen eine Adresse, die die Demo selbst beantwortet.
  NetInfo.configure({
    reachabilityUrl: REACHABILITY_PATH,
    reachabilityTest: async (response) => response.status === 204,
    reachabilityRequestTimeout: 3000,
  });

  try {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !demo.offline });
  } catch {
    /* ältere Browser: Offline-Anzeige ggf. ungenau */
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (raw.startsWith('data:') || raw.startsWith('blob:')) return realFetch(input, init);
    const url = new URL(raw, location.href);
    const isApi = url.pathname.includes('/api/');
    const isReachability = url.pathname.endsWith(REACHABILITY_PATH);
    if (!isApi && !isReachability) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
    if (demo.offline) throw new TypeError('Network request failed');
    if (isReachability) return new Response(null, { status: 204 });
    const headers = new Headers(init?.headers);
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* kein JSON */
      }
    }
    const res = await server.handle((init?.method ?? 'GET').toUpperCase(), url, headers, body);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };

  (window as unknown as { __rrDemo: DemoControl }).__rrDemo = demo;
  window.dispatchEvent(new Event('rrdemo:ready'));
}
