import { Pool, type PoolConfig } from 'pg';
import { headers } from 'next/headers';

let _prodPool: Pool | undefined;
let _sandboxPool: Pool | undefined;

function makePool(raw: string): Pool {
  const url = raw.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  const cfg: PoolConfig = {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
  return new Pool(cfg);
}

export function getPool(isSandbox?: boolean): Pool {
  // Auto-detect from request header when caller doesn't specify
  if (isSandbox === undefined) {
    try {
      isSandbox = headers().get('x-db-mode') === 'sandbox';
    } catch {
      isSandbox = false;
    }
  }

  if (isSandbox) {
    const raw = process.env.SANDBOX_DATABASE_URL || process.env.SANDBOX_POSTGRES_URL;
    if (!raw) throw new Error('SANDBOX_DATABASE_URL is not configured');
    if (!_sandboxPool) {
      _sandboxPool = makePool(raw);
      _sandboxPool.on('error', () => { _sandboxPool = undefined; });
    }
    return _sandboxPool;
  }

  // POSTGRES_URL  = Supabase transaction-mode pooler (port 6543) — best for serverless.
  // DATABASE_URL  = fallback direct connection.
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!raw) throw new Error('No database URL configured (set POSTGRES_URL or DATABASE_URL)');
  if (!_prodPool) {
    _prodPool = makePool(raw);
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
