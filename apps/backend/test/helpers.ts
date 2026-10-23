import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { offsetNorth, type LatLng } from '@rheinraum/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, type Db } from '../src/db/pool.js';
import { seed, DEMO, DEMO_PASSWORD } from '../src/db/seed.js';
import { LocalPhotoStorage } from '../src/services/storage.js';
import type { RoutingProvider } from '../src/services/routing.js';
import { TEST_DATABASE_URL } from './global-setup.js';

export { DEMO, DEMO_PASSWORD, randomUUID };

export interface TestCtx {
  app: FastifyInstance;
  db: Db;
  token: (email: string) => Promise<string>;
  ids: { sites: Record<string, { id: string; lat: number; lng: number; radius: number }>; users: Record<string, string> };
  close: () => Promise<void>;
}

export async function setupTestApp(opts: { routing?: RoutingProvider; env?: Record<string, string> } = {}): Promise<TestCtx> {
  await seed(TEST_DATABASE_URL, { reset: true, log: () => undefined });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234567890',
    ...opts.env,
  });
  const db = createPool(TEST_DATABASE_URL);
  const storage = new LocalPhotoStorage(mkdtempSync(path.join(tmpdir(), 'rr-photos-')));
  const app = await buildApp(config, db, { storage, ...(opts.routing ? { routing: opts.routing } : {}) });

  const sites = Object.fromEntries(
    (await db.query('SELECT id, name, lat, lng, radius_m FROM sites')).rows.map((r) => [
      r.name,
      { id: r.id, lat: r.lat, lng: r.lng, radius: r.radius_m },
    ]),
  );
  const users = Object.fromEntries((await db.query('SELECT id, email FROM users')).rows.map((r) => [r.email, r.id]));

  const cache = new Map<string, string>();
  const token = async (email: string) => {
    if (cache.has(email)) return cache.get(email)!;
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: DEMO_PASSWORD } });
    if (res.statusCode !== 200) throw new Error(`Login ${email} fehlgeschlagen: ${res.body}`);
    const t = res.json().accessToken as string;
    cache.set(email, t);
    return t;
  };

  return {
    app,
    db,
    token,
    ids: { sites, users },
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export function fixAt(site: LatLng, metersNorth: number, accuracy = 10, capturedAt = new Date()) {
  return { ...offsetNorth(site, metersNorth), accuracy, capturedAt: capturedAt.toISOString() };
}

/** Baut einen multipart/form-data-Body (Felder vor der Datei). */
export function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = `----rr${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Minimale gültige JPEG-Signatur mit Fülldaten. */
export const fakeJpeg = (size = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 6, 1), Buffer.from([0xff, 0xd9])]);
