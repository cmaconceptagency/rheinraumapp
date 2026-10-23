import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://handwerk:handwerk@localhost:5432/handwerk_test';

export default async function () {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Test-Datenbank nicht erreichbar (${TEST_DATABASE_URL}). Bitte PostgreSQL starten (docker compose up -d db) ` +
        `oder TEST_DATABASE_URL setzen.\n${(err as Error).message}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
