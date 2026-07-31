import { Pool, type PoolConfig } from 'pg';
import { headers } from 'next/headers';

let _prodPool: Pool | undefined;
let _sandboxPool: Pool | undefined;

// Supabase's Supavisor exposes two ports: 6543 = transaction mode (correct for
// serverless — a client is only held for the duration of a query/transaction),
// 5432 = session mode (holds a backend for the whole connection, and is what
// raises `EMAXCONNSESSION … pool_size: 15`). Force the transaction port so a
// misconfigured env var can't route us onto the session pooler.
function normalizeUrl(raw: string): string {
  let url = raw.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  if (/\.pooler\.supabase\.com:5432\b/.test(url)) {
    url = url.replace('.pooler.supabase.com:5432', '.pooler.supabase.com:6543');
  }
  return url;
}

function makePool(raw: string, schema: 'public' | 'sandbox'): Pool {
  const url = normalizeUrl(raw);
  // On serverless, every warm instance keeps its own Pool. A session-mode
  // pooler caps total clients (pool_size: 15), so keep each instance to a
  // single client and release it quickly to avoid EMAXCONNSESSION.
  const cfg: PoolConfig = {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 5_000,
    maxLifetimeSeconds: 30,
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
