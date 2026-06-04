import { Pool, type PoolConfig } from 'pg';
import { headers } from 'next/headers';

let _prodPool: Pool | undefined;
let _sandboxPool: Pool | undefined;

function makePool(raw: string, schema: 'public' | 'sandbox'): Pool {
  const url = raw.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  const cfg: PoolConfig = {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
  const pool = new Pool(cfg);
  // Route each connection to the correct schema
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${schema}, extensions, public`);
  });
  return pool;
}

export function getPool(isSandbox?: boolean): Pool {
  if (isSandbox === undefined) {
    try {
      isSandbox = headers().get('x-db-mode') === 'sandbox';
    } catch {
      isSandbox = false;
    }
  }

  // POSTGRES_URL  = Supabase transaction-mode pooler (port 6543) — best for serverless.
  // DATABASE_URL  = fallback direct connection.
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('No database URL configured (set POSTGRES_URL or DATABASE_URL)');

  if (isSandbox) {
    if (!_sandboxPool) {
      _sandboxPool = makePool(raw, 'sandbox');
      _sandboxPool.on('error', () => { _sandboxPool = undefined; });
    }
    return _sandboxPool;
  }

  if (!_prodPool) {
    _prodPool = makePool(raw, 'public');
    _prodPool.on('error', () => { _prodPool = undefined; });
  }
  return _prodPool;
}

export function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return getPool()
    .query(sql, params)
    .then((r) => r.rows as T[]);
}
