import { Pool, type PoolConfig } from 'pg';

let _pool: Pool | undefined;

export function getPool(): Pool {
  if (!_pool) {
    // POSTGRES_URL  = Supabase transaction-mode pooler (port 6543) — best for serverless.
    // DATABASE_URL  = fallback session-mode pooler (port 5432, pool_size 15).
    const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!raw) throw new Error('No database URL configured (set POSTGRES_URL or DATABASE_URL)');

    // Strip sslmode from the URL so it does not conflict with our explicit ssl config below.
    const url = raw.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');

    const cfg: PoolConfig = {
      connectionString: url,
      // Supabase (and most cloud Postgres) use certs that are signed by a private CA.
      // rejectUnauthorized:false trusts the server without verifying the chain.
      ssl: { rejectUnauthorized: false },
      max: 3,                   // 3 connections per serverless instance
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    };

    _pool = new Pool(cfg);
    _pool.on('error', () => { _pool = undefined; });
  }
  return _pool;
}

export function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return getPool()
    .query(sql, params)
    .then((r) => r.rows as T[]);
}
