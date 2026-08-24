export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { normalizeScan, entityFromCode, isValidScanCode } from '@/lib/scan-codes';

// Resolve a scanned QR code to the thing it names, plus enough context for the
// scan screen to show the operator what they just picked up (where it is now,
// and what's on it). Read-only — nothing moves until /wms/scan/move is called.

interface LabelRow { entity_type: string; entity_id: string; company_id: string; is_active: boolean }

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const code = normalizeScan(searchParams.get('code') ?? '');
  if (!code) return err('code is required', 400);
  if (!isValidScanCode(code)) return err(`Unrecognised code "${code}"`, 422);

  const [label] = await query<LabelRow>(
    `SELECT entity_type, entity_id, company_id, is_active FROM qr_labels WHERE code = $1`,
    [code],
  );
  if (!label) return err(`No label registered for "${code}"`, 404);
  // Scoped by company so a code from another tenant can't be acted on here.
  if (label.company_id !== companyId) return err(`Label "${code}" belongs to another company`, 403);
  if (!label.is_active) return err(`Label "${code}" has been retired`, 410);

  const entity = entityFromCode(code);

  if (entity === 'bin') {
    const [bin] = await query(
      `SELECT b.id, b.code, b.zone, b.bin_type, b.is_active,
              b.warehouse_id, w.name AS warehouse_name,
              (SELECT COALESCE(SUM(qty_on_hand), 0) FROM bin_stock_balances s WHERE s.bin_id = b.id) AS qty_on_hand,
              (SELECT COUNT(*)::int FROM dp_storage_boxes x WHERE x.bin_id = b.id AND x.status = 'in_storage') AS box_count
         FROM bins b
         JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.id = $1`,
      [label.entity_id],
    );
    if (!bin) return err('Bin no longer exists', 404);
    return ok({ code, entity_type: 'bin', bin });
  }

  if (entity === 'box') {
    const [box] = await query(
      `SELECT x.id, x.box_uuid, x.product, x.net_weight_kg, x.status,
              x.pallet_id, p.pallet_no,
              x.bin_id, b.code AS bin_code, x.warehouse_id, w.name AS warehouse_name,
              x.item_id, x.lot_id, l.lot_no,
              x.job_order_id, jo.batch_no, x.time_in
         FROM dp_storage_boxes x
         LEFT JOIN pallets    p  ON p.id  = x.pallet_id
         LEFT JOIN bins       b  ON b.id  = x.bin_id
         LEFT JOIN warehouses w  ON w.id  = x.warehouse_id
         LEFT JOIN item_lots  l  ON l.id  = x.lot_id
         LEFT JOIN dp_job_orders jo ON jo.id = x.job_order_id
        WHERE x.id = $1`,
      [label.entity_id],
    );
    if (!box) return err('Box no longer exists', 404);
    return ok({ code, entity_type: 'box', box });
  }

  const [pallet] = await query(
    `SELECT p.id, p.pallet_no, p.status, p.bin_id, b.code AS bin_code,
            p.warehouse_id, w.name AS warehouse_name,
            (SELECT COUNT(*)::int FROM dp_storage_boxes x
              WHERE x.pallet_id = p.id AND x.status = 'in_storage') AS box_count,
            (SELECT COALESCE(SUM(x.net_weight_kg), 0) FROM dp_storage_boxes x
              WHERE x.pallet_id = p.id AND x.status = 'in_storage') AS net_weight_kg
       FROM pallets p
       LEFT JOIN bins       b ON b.id = p.bin_id
       LEFT JOIN warehouses w ON w.id = p.warehouse_id
      WHERE p.id = $1`,
    [label.entity_id],
  );
  if (!pallet) return err('Pallet no longer exists', 404);

  const boxes = await query(
    `SELECT x.id, x.product, x.net_weight_kg, x.item_id, x.lot_id
       FROM dp_storage_boxes x
      WHERE x.pallet_id = $1 AND x.status = 'in_storage'
      ORDER BY x.time_in`,
    [label.entity_id],
  );
  return ok({ code, entity_type: 'pallet', pallet, boxes });
}
