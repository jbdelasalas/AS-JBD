export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Transfer a batch's processed output into WMS.
//
// For each untransferred production line it:
//   1. ensures a lot per (item, batch, size) for traceability,
//   2. adds the weight to bin_stock_balances (WMS sub-ledger),
//   3. writes a stock_movements row,
//   4. creates a dp_storage_boxes row so the cold-storage clock/billing starts,
//   5. marks the line transferred (idempotent — re-running skips done lines).
//
// Body: { company_id, job_order_id, warehouse_id, bin_id }

const NIL = '00000000-0000-0000-0000-000000000000';

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const jobOrderId = dto.job_order_id as string;
  const warehouseId = dto.warehouse_id as string;
  const binId = dto.bin_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!jobOrderId) return err('job_order_id is required', 400);
  if (!warehouseId) return err('warehouse_id is required', 400);
  if (!binId) return err('bin_id is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const jo = (await client.query<{ batch_no: string }>(
      `SELECT batch_no FROM dp_job_orders WHERE id = $1 AND company_id = $2`,
      [jobOrderId, companyId],
    )).rows[0];
    if (!jo) { await client.query('ROLLBACK'); return err('Batch not found', 404); }

    const lines = (await client.query<{
      id: string; item_id: string; size_code: string | null; item_name: string;
      weight_kg: string; pack_count: number;
    }>(
      `SELECT po.id, po.item_id, po.weight_kg, po.pack_count, i.name AS item_name,
              s.code AS size_code
         FROM dp_processed_output po
         JOIN items i ON i.id = po.item_id
         LEFT JOIN dp_sizes s ON s.id = po.size_id
        WHERE po.job_order_id = $1 AND (po.transferred_kg IS NULL OR po.transferred_kg = 0)
          AND po.weight_kg > 0`,
      [jobOrderId],
    )).rows;

    if (lines.length === 0) {
      await client.query('ROLLBACK');
      return err('Nothing to transfer — no untransferred production lines with weight.', 409);
    }

    let boxes = 0;
    let totalKg = 0;
    for (const l of lines) {
      const weight = Number(l.weight_kg);
      const lotNo = `${jo.batch_no}${l.size_code ? '-' + l.size_code : ''}`;

      // 1. Lot per item+batch+size (item may not be lot-tracked; lot still gives traceability).
      const lot = (await client.query<{ id: string }>(
        `INSERT INTO item_lots (company_id, item_id, lot_no, notes)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (item_id, lot_no) DO UPDATE SET notes = item_lots.notes
         RETURNING id`,
        [companyId, l.item_id, lotNo, `Dressing-plant batch ${jo.batch_no}`],
      )).rows[0];

      // 2. Add to WMS bin stock.
      await client.query(
        `INSERT INTO bin_stock_balances
           (company_id, item_id, warehouse_id, bin_id, lot_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1,$2,$3,$4,$5,$6,0, now())
         ON CONFLICT (item_id, bin_id, COALESCE(lot_id, '${NIL}'::uuid)) DO UPDATE SET
           qty_on_hand = bin_stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
           last_movement_at = now()`,
        [companyId, l.item_id, warehouseId, binId, lot.id, weight],
      );

      // 3. Stock movement (best-effort — never block the transfer on it).
      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, bin_id, lot_id, created_by)
         VALUES ($1,$2,$3,'receipt',$4,0,0,'dp_production',$5,$6,$7,$8,$9)`,
        [companyId, l.item_id, warehouseId, weight, l.id, jo.batch_no, binId, lot.id, auth.userId],
      ).catch(() => {});

      // 4. Cold-storage box so the storage clock/billing starts.
      await client.query(
        `INSERT INTO dp_storage_boxes (company_id, job_order_id, product, net_weight_kg, room)
         VALUES ($1,$2,$3,$4,$5)`,
        [companyId, jobOrderId, `${l.item_name}${l.size_code ? ' (' + l.size_code + ')' : ''}`, weight, 'WMS'],
      );

      // 5. Mark line transferred.
      await client.query(
        `UPDATE dp_processed_output SET transferred_kg = weight_kg, transferred_at = now() WHERE id = $1`,
        [l.id],
      );
      boxes += 1;
      totalKg += weight;
    }

    await client.query('COMMIT');
    return ok({ transferred_lines: boxes, total_kg: Number(totalKg.toFixed(2)), warehouse_id: warehouseId, bin_id: binId }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Transfer to WMS failed', 500);
  } finally {
    client.release();
  }
}
