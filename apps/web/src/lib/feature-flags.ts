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
 * Returns whether a feature flag is enabled. Unknown / missing flags are treated
 * as OFF — a flag that hasn't been created yet should never silently enable
 * behaviour. Any DB error also resolves to `false` so a flag-read failure can
 * never crash a posting transaction; it just falls back to the safe default.
 *
 * @param name   the flag's unique `name` (e.g. 'allow_negative_inventory')
 * @param client optional transaction client — pass this when calling from inside
 *               a BEGIN/COMMIT block so the read joins the same transaction.
 */
export async function isFeatureEnabled(
  name: string,
  client?: Queryable,
): Promise<boolean> {
  try {
    if (client) {
      const res = await client.query(
        `SELECT enabled FROM feature_flags WHERE name = $1 LIMIT 1`,
        [name],
      );
      return res.rows[0]?.enabled ?? false;
    }
    const rows = await query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE name = $1 LIMIT 1`,
      [name],
    );
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
