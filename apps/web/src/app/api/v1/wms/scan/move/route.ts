export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool, query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { adjustBinBalance, binQtyOnHand } from '@/lib/wms';
import { normalizeScan, entityFromCode, isValidScanCode, codeFor, type ScanEntity } from '@/lib/scan-codes';

// Commit a scanned movement: <thing> -> <destination bin>.
//
// A move is bin-to-bin *within* a warehouse, so it touches only the bin
// sub-ledger (bin_stock_balances). Warehouse-level stock_balances is
// deliberately left alone — the warehouse total hasn't changed, and the
// put-away route documents the same invariant.
//
// Everything runs in one transaction: if any box on a pallet fails, the whole
// move rolls back rather than leaving a half-moved stack on the floor.

interface MoveResult { moved: number; qty: number; boxes: number }

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const sourceCode = normalizeScan((dto.code as string) ?? '');
  const destCode = normalizeScan((dto.to_bin_code as string) ?? '');
  if (!sourceCode) return err('code is required', 400);
  if (!destCode) return err('to_bin_code is required', 400);
  if (!isValidScanCode(sourceCode)) return err(`Unrecognised code "${sourceCode}"`, 422);
  if (!isValidScanCode(destCode)) return err(`Unrecognised destination "${destCode}"`, 422);

  const sourceEntity = entityFromCode(sourceCode) as ScanEntity;
  if (entityFromCode(destCode) !== 'bin') return err('Destination must be a bin label', 422);
  if (sourceCode === destCode) return err('Source and destination are the same label', 422);

  const deviceLabel = ((dto.device_label as string) ?? '').slice(0, 60) || null;
  const notes = ((dto.notes as string) ?? '').slice(0, 500) || null;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // --- Resolve destination bin -------------------------------------------
    const destRes = await client.query(
      `SELECT b.id, b.code, b.warehouse_id, b.is_active, q.company_id
         FROM qr_labels q
         JOIN bins b ON b.id = q.entity_id
        WHERE q.code = $1 AND q.entity_type = 'bin' AND q.is_active`,
      [destCode],
    );
    const dest = destRes.rows[0];
    if (!dest) { await client.query('ROLLBACK'); return err(`Destination bin "${destCode}" not found`, 404); }
    if (dest.company_id !== companyId) { await client.query('ROLLBACK'); return err('Destination belongs to another company', 403); }
    if (!dest.is_active) { await client.query('ROLLBACK'); return err(`Bin ${dest.code} is inactive`, 409); }

    // --- Resolve source -----------------------------------------------------
    const srcRes = await client.query(
      `SELECT entity_id, company_id FROM qr_labels
        WHERE code = $1 AND entity_type = $2 AND is_active`,
      [sourceCode, sourceEntity],
    );
    const src = srcRes.rows[0];
    if (!src) { await client.query('ROLLBACK'); return err(`Label "${sourceCode}" not found`, 404); }
    if (src.company_id !== companyId) { await client.query('ROLLBACK'); return err('Label belongs to another company', 403); }

    const moveRef = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    const result: MoveResult = { moved: 0, qty: 0, boxes: 0 };

    const logEvent = async (
      entityType: string, entityId: string, code: string | null,
      fromBinId: string | null, itemId: string | null, lotId: string | null, qty: number,
    ) => {
      await client.query(
        `INSERT INTO inventory_scan_events
           (company_id, move_ref, entity_type, entity_id, code, from_bin_id, to_bin_id,
            item_id, lot_id, qty, scanned_by, device_label, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [companyId, moveRef, entityType, entityId, code, fromBinId, dest.id,
         itemId, lotId, qty, auth.userId, deviceLabel, notes],
      );
    };

    // Move one storage box, shifting its stock between bins when the box is
    // linked to an inventory item. Boxes without an item_id (plant-only boxes
    // that never entered WMS) still move and are still journalled.
    const moveBox = async (box: Record<string, unknown>) => {
      const fromBinId = box.bin_id ? String(box.bin_id) : null;
      const itemId = box.item_id ? String(box.item_id) : null;
      const lotId = box.lot_id ? String(box.lot_id) : null;
      const qty = Number(box.net_weight_kg ?? 0);

      if (itemId && fromBinId !== dest.id) {
        if (fromBinId) {
          const available = await binQtyOnHand(client, itemId, fromBinId, lotId);
          if (available < qty) {
            throw new Error(
              `Source bin holds only ${available} kg of the ${qty} kg on box ${String(box.box_uuid).slice(0, 8)}`,
            );
          }
          // Carry the source bin's cost across so the move is cost-neutral.
          // Read defensively rather than destructuring a possibly-empty result.
          const costRow = (await client.query(
            `SELECT avg_cost FROM bin_stock_balances
              WHERE item_id=$1 AND bin_id=$2
                AND COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)
                  = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
              LIMIT 1`,
            [itemId, fromBinId, lotId],
          )).rows[0];
          const cost = Number(costRow?.avg_cost ?? 0);
          // Draw down against the SOURCE bin's own warehouse — passing the
          // destination's would rewrite warehouse_id on the source balance row
          // when the two bins live in different warehouses.
          const fromWarehouse = String(box.warehouse_id ?? dest.warehouse_id);
          await adjustBinBalance(client, companyId, itemId, fromWarehouse, fromBinId, lotId, -qty, cost);
          await adjustBinBalance(client, companyId, itemId, String(dest.warehouse_id), String(dest.id), lotId, qty, cost);
        } else {
          // First time into a bin (straight off the line) — no source to draw down.
          await adjustBinBalance(client, companyId, itemId, String(dest.warehouse_id), String(dest.id), lotId, qty, 0);
        }
      }

      await client.query(
        `UPDATE dp_storage_boxes
            SET bin_id = $1, warehouse_id = $2
          WHERE id = $3`,
        [dest.id, dest.warehouse_id, box.id],
      );
      // Journal the label code, which is derived from the box's id — not its
      // box_uuid, which is a separate legacy barcode value.
      await logEvent('box', String(box.id), codeFor('box', String(box.id)),
        fromBinId, itemId, lotId, qty);
      result.boxes++;
      result.qty += qty;
    };

    if (sourceEntity === 'box') {
      const boxRes = await client.query(
        `SELECT id, box_uuid, bin_id, warehouse_id, item_id, lot_id, net_weight_kg, status
           FROM dp_storage_boxes WHERE id = $1 FOR UPDATE`,
        [src.entity_id],
      );
      const box = boxRes.rows[0];
      if (!box) { await client.query('ROLLBACK'); return err('Box no longer exists', 404); }
      if (box.status !== 'in_storage') {
        await client.query('ROLLBACK');
        return err(`Box is ${box.status} and can no longer be moved`, 409);
      }
      await moveBox(box);
      result.moved = 1;

    } else if (sourceEntity === 'pallet') {
      const palletRes = await client.query(
        `SELECT id, pallet_no, status, bin_id FROM pallets WHERE id = $1 FOR UPDATE`,
        [src.entity_id],
      );
      const pallet = palletRes.rows[0];
      if (!pallet) { await client.query('ROLLBACK'); return err('Pallet no longer exists', 404); }
      if (pallet.status === 'shipped') {
        await client.query('ROLLBACK');
        return err('Pallet has shipped and can no longer be moved', 409);
      }

      const boxes = (await client.query(
        `SELECT id, box_uuid, bin_id, warehouse_id, item_id, lot_id, net_weight_kg
           FROM dp_storage_boxes
          WHERE pallet_id = $1 AND status = 'in_storage'
          ORDER BY time_in
          FOR UPDATE`,
        [pallet.id],
      )).rows;

      for (const box of boxes) await moveBox(box);

      await client.query(
        `UPDATE pallets SET bin_id = $1, warehouse_id = $2, updated_at = now() WHERE id = $3`,
        [dest.id, dest.warehouse_id, pallet.id],
      );
      // Journal the pallet itself, so relocating an empty pallet is still traceable.
      await logEvent('pallet', String(pallet.id), sourceCode,
        pallet.bin_id ? String(pallet.bin_id) : null, null, null, 0);
      result.moved = 1;

    } else {
      await client.query('ROLLBACK');
      return err('Scan a box or pallet to move; a bin is the destination', 422);
    }

    await client.query('COMMIT');
    return ok({
      move_ref: moveRef,
      entity_type: sourceEntity,
      to_bin: { id: dest.id, code: dest.code },
      ...result,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to record movement', 500);
  } finally {
    client.release();
  }
}

// Recent movement history, for the activity feed under the scanner.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const limit = Math.min(Number(searchParams.get('limit') ?? 25) || 25, 100);

  const rows = await query(
    `SELECT e.id, e.move_ref, e.entity_type, e.code, e.qty, e.scanned_at, e.device_label,
            fb.code AS from_bin_code, tb.code AS to_bin_code,
            u.full_name AS scanned_by_name,
            i.name AS item_name
       FROM inventory_scan_events e
       LEFT JOIN bins fb ON fb.id = e.from_bin_id
       LEFT JOIN bins tb ON tb.id = e.to_bin_id
       LEFT JOIN users u ON u.id = e.scanned_by
       LEFT JOIN items i ON i.id = e.item_id
      WHERE e.company_id = $1
      ORDER BY e.scanned_at DESC
      LIMIT $2`,
    [companyId, limit],
  );
  return ok({ data: rows });
}
