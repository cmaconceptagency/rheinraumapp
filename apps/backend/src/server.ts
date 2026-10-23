import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = await buildApp(config, db);

if (config.ROUTING_PROVIDER === 'simulated') {
  app.log.warn('ROUTING_PROVIDER=simulated: Entfernungen sind SIMULIERT (Luftlinie × 1,3), keine echte Straßenberechnung.');
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
