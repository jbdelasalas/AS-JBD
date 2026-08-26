// Feature flags — central read layer.
//
// Flags are rows in the `feature_flags` table, managed by superadmins in
// Administration → Feature Flags. This module is the single place application
// code should consult to ask "is feature X turned on?". Keep the raw SQL here so
// callers never hand-roll the query (it used to be copy-pasted into each route).

import { query } from '@/lib/db';
import type { PoolClient } from 'pg';

// A minimal shape so this helper works both with the plain `query` wrapper and
// with a `PoolClient` already inside a transaction (so a flag read participates
// in the same BEGIN/COMMIT as the surrounding work).
type Queryable = Pick<PoolClient, 'query'>;

/**
 * Options for a flag read. Both are optional so the common "is this on at all?"
 * call stays a one-liner.
 */
export interface FlagOptions {
  /** Transaction client — pass when calling from inside a BEGIN/COMMIT block so
   *  the read joins the same transaction. */
  client?: Queryable;
  /** Company the check is being made for. Only matters when the flag has a
   *  per-company scope; see `isFeatureEnabled` for how it is applied. */
  companyId?: string | null;
}

// `enabled` is the master switch: a flag that is off is off everywhere.
// `rollout_companies` then narrows an on flag to specific companies:
//   - empty array  → the flag applies to every company (global rollout)
//   - non-empty    → the flag applies only to the listed companies
// A caller that passes no companyId gets the global answer (`enabled` alone),
// which is the right result for company-agnostic checks and keeps every
// pre-existing call site behaving exactly as it did before scoping existed.
const FLAG_SQL = `
  SELECT enabled
           AND (
             $2::uuid IS NULL
             OR cardinality(rollout_companies) = 0
             OR $2::uuid = ANY (rollout_companies)
           ) AS enabled
    FROM feature_flags
   WHERE name = $1
   LIMIT 1`;

/**
 * Returns whether a feature flag is enabled, optionally for a specific company.
 * Unknown / missing flags are treated as OFF — a flag that hasn't been created
 * yet should never silently enable behaviour. Any DB error also resolves to
 * `false` so a flag-read failure can never crash a posting transaction; it just
 * falls back to the safe default.
 *
 * @param name    the flag's unique `name` (e.g. 'allow_negative_inventory')
 * @param options transaction client and/or the company to scope the check to.
 *                For backwards compatibility a bare `Queryable` is still
 *                accepted in place of the options object.
 */
export async function isFeatureEnabled(
  name: string,
  options?: FlagOptions | Queryable,
): Promise<boolean> {
  // Distinguish `{ client, companyId }` from a raw PoolClient passed positionally
  // by the older call style — a Queryable has a `query` method, the options bag
  // never does.
  const opts: FlagOptions =
    options && typeof (options as Queryable).query === 'function'
      ? { client: options as Queryable }
      : ((options as FlagOptions) ?? {});

  const params = [name, opts.companyId ?? null];

  try {
    if (opts.client) {
      const res = await opts.client.query(FLAG_SQL, params);
      return res.rows[0]?.enabled ?? false;
    }
    const rows = await query<{ enabled: boolean }>(FLAG_SQL, params);
    return rows[0]?.enabled ?? false;
  } catch {
    return false;
  }
}

// Known flag names. Use these constants instead of string literals so a typo
// becomes a compile error and every flag the code relies on is discoverable here.
export const FLAGS = {
  ALLOW_NEGATIVE_INVENTORY: 'allow_negative_inventory',
  WMS: 'wms',
  // Vertical-module toggles. These default to ON in the DB; a superadmin turns a
  // flag OFF to hide that module's nav group for a deployment that doesn't use it.
  POULTRY: 'poultry',
  RESTAURANT: 'restaurant',
  FUEL: 'fuel',
  // Opt-in vertical (like WMS): hidden until a superadmin turns it ON.
  DRESSING_PLANT: 'dressing_plant',
} as const;
