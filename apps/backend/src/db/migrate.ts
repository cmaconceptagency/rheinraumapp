import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Liegt sowohl von src/db als auch von dist/db aus zwei Ebenen höher.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export async function migrate(connectionString: string, log: (msg: string) => void = console.log): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`Migration angewendet: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} fehlgeschlagen: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL fehlt (siehe apps/backend/.env.example)');
    process.exit(1);
  }
  migrate(url)
    .then(() => console.log('Datenbank ist aktuell.'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
