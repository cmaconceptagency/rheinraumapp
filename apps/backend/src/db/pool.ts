import pg from 'pg';

// DATE-Spalten als 'YYYY-MM-DD'-Text liefern statt als JS-Date (vermeidet Zeitzonenverschiebungen).
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Führt `fn` in einer Transaktion aus. */
export async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
