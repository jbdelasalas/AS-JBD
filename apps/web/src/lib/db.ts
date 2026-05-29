import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 1,                      // one connection per serverless instance
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 5000,     // release idle connections quickly
      query_timeout: 15000,
    });
    pool.on('error', () => { pool = undefined; });
  }
  return pool;
}

export function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return getPool()
    .query(sql, params)
    .then((r) => r.rows as T[]);
}
