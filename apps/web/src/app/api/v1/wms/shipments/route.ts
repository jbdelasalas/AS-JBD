export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo, binQtyOnHand } from '@/lib/wms';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `s.company_id = $1`;
  const status = searchParams.get('status');
  if (status && status !== 'all') { params.push(status); where += ` AND s.status = $${params.length}`; }

  const rows = await query(
    `SELECT s.id, s.shipment_no, s.status, s.created_at, s.shipped_at, s.carrier, s.tracking_no,
            w.name AS warehouse_name, so.order_no, pl.pick_no
       FROM shipments s
       JOIN warehouses w ON w.id = s.warehouse_id
       LEFT JOIN sales_orders so ON so.id = s.so_id
       LEFT JOIN pick_lists pl ON pl.id = s.pick_id
      WHERE ${where}
      ORDER BY s.created_at DESC
      LIMIT 500`,
    params,
  );
  return ok({ data: rows });
}

// Create a draft shipment. If pick_id is given, lines are derived from the
// (packed) pick list's picked quantities and the cost is read from the bin.
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const pickId = dto.pick_id as string | undefined;
  if (!companyId) return err('company_id is required', 400);
  if (!pickId && !dto.warehouse_id) return err('warehouse_id is required when no pick list is given', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    let warehouseId = dto.warehouse_id as string;
    let soId: string | null = (dto.so_id as string) ?? null;
    const derivedLines: Array<{ item_id: string; bin_id: string; lot_id: string | null; qty: number; unit_cost: number }> = [];

    if (pickId) {
      const { rows: [pl] } = await client.query(`SELECT * FROM pick_lists WHERE id = $1 LIMIT 1`, [pickId]);
      if (!pl) throw new Error('Pick list not found');
      if (pl.status !== 'packed') throw new Error('Pick list must be packed before shipping');
      warehouseId = String(pl.warehouse_id);
      soId = pl.so_id ? String(pl.so_id) : null;
      const { rows: plLines } = await client.query(`SELECT * FROM pick_list_lines WHERE pick_id = $1 AND qty_picked > 0`, [pickId]);
      for (const l of plLines) {
        const cost = await client.query(
          `SELECT avg_cost FROM bin_stock_balances WHERE item_id=$1 AND bin_id=$2
             AND COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`,
          [l.item_id, l.bin_id, l.lot_id],
        );
        derivedLines.push({
          item_id: String(l.item_id), bin_id: String(l.bin_id), lot_id: l.lot_id ? String(l.lot_id) : null,
          qty: Number(l.qty_picked), unit_cost: cost.rows[0] ? Number(cost.rows[0].avg_cost) : 0,
        });
      }
    } else {
      const ls = (dto.lines as Array<Record<string, unknown>>) ?? [];
      for (const l of ls) {
        if (!l.item_id || !l.bin_id || !(Number(l.qty) > 0)) throw new Error('Each line needs item, bin, and positive qty');
        const cost = await client.query(
          `SELECT avg_cost FROM bin_stock_balances WHERE item_id=$1 AND bin_id=$2
             AND COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`,
          [l.item_id, l.bin_id, l.lot_id ?? null],
        );
        derivedLines.push({
          item_id: String(l.item_id), bin_id: String(l.bin_id), lot_id: (l.lot_id as string) ?? null,
          qty: Number(l.qty), unit_cost: cost.rows[0] ? Number(cost.rows[0].avg_cost) : 0,
        });
      }
    }
    if (!derivedLines.length) throw new Error('Shipment has no lines');

    // Up-front availability check so a draft is never created against missing stock.
    for (const l of derivedLines) {
      const avail = await binQtyOnHand(client, l.item_id, l.bin_id, l.lot_id);
      if (l.qty > avail) throw new Error(`Bin only holds ${avail} for one of the lines (tried to ship ${l.qty})`);
    }

    const shipNo = await nextDocNo(client, companyId, 'shipments', 'shipment_no', 'SHP');
    const { rows: [header] } = await client.query(
      `INSERT INTO shipments (company_id, shipment_no, pick_id, so_id, warehouse_id, carrier, tracking_no, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING *`,
      [companyId, shipNo, pickId ?? null, soId, warehouseId, dto.carrier ?? null, dto.tracking_no ?? null, dto.notes ?? null, auth.userId],
    );
    for (let i = 0; i < derivedLines.length; i++) {
      const l = derivedLines[i];
      await client.query(
        `INSERT INTO shipment_lines (shipment_id, line_no, item_id, bin_id, lot_id, qty, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, i + 1, l.item_id, l.bin_id, l.lot_id, l.qty, l.unit_cost],
      );
    }
    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create shipment', 400);
  } finally { client.release(); }
}
