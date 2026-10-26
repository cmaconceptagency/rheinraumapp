import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ERROR_MESSAGES } from '@rheinraum/shared';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { registerErrorHandler } from './errors.js';
import { TokenService } from './auth/tokens.js';
import { makeAuthenticate } from './auth/plugin.js';
import { createRoutingProvider, type RoutingProvider } from './services/routing.js';
import { LocalPhotoStorage, type PhotoStorage } from './services/storage.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';
import { photoRoutes } from './routes/photos.js';

export interface AppDeps {
  config: Config;
  db: Db;
  tokens: TokenService;
  routing: RoutingProvider;
  storage: PhotoStorage;
  authenticate: ReturnType<typeof makeAuthenticate>;
}

export async function buildApp(
  config: Config,
  db: Db,
  overrides: Partial<Pick<AppDeps, 'routing' | 'storage'>> = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  const tokens = new TokenService(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_MIN);
  const deps: AppDeps = {
    config,
    db,
    tokens,
    routing: overrides.routing ?? createRoutingProvider(config.ROUTING_PROVIDER, config.OSRM_URL),
    storage: overrides.storage ?? new LocalPhotoStorage(config.STORAGE_DIR),
    authenticate: makeAuthenticate(db, tokens),
  };

  registerErrorHandler(app);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 } });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, serverTime: new Date().toISOString() };
  });

  await app.register(async (r) => authRoutes(r, deps), { prefix: '/api/auth' });
  await app.register(async (r) => meRoutes(r, deps), { prefix: '/api/me' });
  await app.register(async (r) => adminRoutes(r, deps), { prefix: '/api/admin' });
  await app.register(async (r) => photoRoutes(r, deps), { prefix: '/api/photos' });

  // Admin-Weboberfläche unter derselben Adresse (nötig für das httpOnly-Refresh-Cookie mit SameSite=Strict).
  const adminDir = config.ADMIN_DIST_DIR ? path.resolve(config.ADMIN_DIST_DIR) : null;
  if (adminDir && existsSync(path.join(adminDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: adminDir, prefix: '/', wildcard: false, index: ['index.html'] });
  } else if (adminDir) {
    app.log.warn(`ADMIN_DIST_DIR=${adminDir} enthält keine index.html – Admin-Oberfläche wird nicht ausgeliefert.`);
  }
  app.setNotFoundHandler((req, reply) => {
    // Seiten der Admin-Oberfläche (z. B. /arbeitszeiten) liefern die Single-Page-App aus.
    if (adminDir && req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(path.join(adminDir, 'index.html'))) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: ERROR_MESSAGES.NOT_FOUND } });
  });

  return app;
}
