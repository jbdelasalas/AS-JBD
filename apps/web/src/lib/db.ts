import { Pool } from 'pg';

// eslint-disable-next-line prefer-const
let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
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
