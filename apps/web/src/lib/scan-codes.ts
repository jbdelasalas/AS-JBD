// Shared vocabulary for QR-driven inventory movement.
//
// A label code is `<PREFIX>-<32 hex chars>` (the entity's uuid without dashes).
// Deriving the code from the uuid means a label can always be regenerated for a
// row without a lookup, and the prefix lets the scanner tell a bin from a box
// before it hits the database.

import type { PoolClient } from 'pg';

export type ScanEntity = 'bin' | 'box' | 'pallet';

export const SCAN_PREFIX: Record<ScanEntity, string> = {
  bin: 'BIN',
  box: 'BOX',
  pallet: 'PLT',
};

const PREFIX_TO_ENTITY: Record<string, ScanEntity> = {
  BIN: 'bin',
  BOX: 'box',
  PLT: 'pallet',
};

/** Build the canonical code for an entity, e.g. codeFor('bin', id) -> 'BIN-a1b2…'. */
export function codeFor(entity: ScanEntity, id: string): string {
  return `${SCAN_PREFIX[entity]}-${id.replace(/-/g, '').toLowerCase()}`;
}

/**
 * Normalise whatever the scanner handed us into a bare code.
 *
 * Hardware wedges append newlines/tabs, some scanners upper-case everything,
 * and a QR may hold a full URL (…/dashboard/wms/scan?code=BIN-…) when it was
 * printed for phone-camera use. All of those must land on the same string.
 */
export function normalizeScan(raw: string): string {
  let s = (raw ?? '').trim().replace(/[\r\n\t]+/g, '');
  if (!s) return '';

  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      s = url.searchParams.get('code') ?? url.pathname.split('/').filter(Boolean).pop() ?? s;
    } catch {
      /* fall through and treat it as a literal code */
    }
  }

  s = s.trim();
  const m = /^([A-Za-z]{3})-([0-9a-fA-F]{32})$/.exec(s);
  if (!m) return s.toUpperCase();
  return `${m[1].toUpperCase()}-${m[2].toLowerCase()}`;
}

/** The entity kind a code refers to, or null when the code isn't ours. */
export function entityFromCode(code: string): ScanEntity | null {
  const m = /^([A-Z]{3})-[0-9a-f]{32}$/.exec(code);
  return m ? PREFIX_TO_ENTITY[m[1]] ?? null : null;
}

/** True when `code` is a well-formed label code. */
export function isValidScanCode(code: string): boolean {
  return entityFromCode(code) !== null;
}

/**
 * Ensure a label row exists for an entity and return its code. Safe to call
 * repeatedly — re-registering an entity returns the existing active code.
 */
export async function ensureLabel(
  client: PoolClient, companyId: string, entity: ScanEntity, entityId: string,
  userId?: string | null,
): Promise<string> {
  const code = codeFor(entity, entityId);
  await client.query(
    `INSERT INTO qr_labels (company_id, code, entity_type, entity_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO NOTHING`,
    [companyId, code, entity, entityId, userId ?? null],
  );
  return code;
}
