export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Inbound fuel deliveries (from refinery/supplier into a storage tank).
//
// The trade-recognised quantity is received_litres_15c (litres at 15°C); that is
// what posts to inventory. Posting mirrors the goods-receipt pattern: a
// weighted-average cost update on stock_balances plus a stock_movements row.
//
// The fuel-specific GL/excise journal entry (the schema already carries
// excise_tax_amount, vat_amount, bill_id, je_id) is intentionally left for the
// next pass; this foundation gets stock moving correctly first.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `fd.company_id = $1`;

  const tankId = searchParams.get('tank_id');
  if (tankId) { params.push(tankId); where += ` AND fd.tank_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT fd.id, fd.delivery_no, fd.delivery_date, fd.status,
            fd.received_litres_15c, fd.received_litres_obs, fd.variance_litres,
            fd.unit_cost, fd.total_cost, fd.truck_plate_no, fd.bol_no,
            t.tank_no, i.name AS item_name, s.name AS supplier_name
       FROM fuel_deliveries fd
       JOIN fuel_tanks t  ON t.id = fd.tank_id
       JOIN items i       ON i.id = fd.item_id
       JOIN suppliers s   ON s.id = fd.supplier_id
      WHERE ${where}
      ORDER BY fd.delivery_date DESC, fd.delivery_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM fuel_deliveries fd WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows,
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const tankId = dto.tank_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!tankId)    return err('tank_id is required', 400);
  if (!dto.supplier_id)   return err('supplier_id is required', 400);
  if (!dto.delivery_date) return err('delivery_date is required', 400);

  const receivedL15 = Number(dto.received_litres_15c);
  if (!(receivedL15 > 0)) return err('received_litres_15c must be greater than 0', 400);
  // Default observed volume to the L15 figure when the operator didn't capture it.
  const receivedObs = dto.received_litres_obs != null ? Number(dto.received_litres_obs) : receivedL15;
  const unitCost = dto.unit_cost != null ? Number(dto.unit_cost) : 0;

  // Resolve the tank → its warehouse + fuel product; everything keys off this.
  const tankRows = await query<{ warehouse_id: string; item_id: string }>(
    `SELECT warehouse_id, item_id FROM fuel_tanks
      WHERE id = $1 AND company_id = $2 AND is_active = true LIMIT 1`,
    [tankId, companyId],
  );
  if (!tankRows[0]) return err('Tank not found or inactive', 404);
  const { warehouse_id: warehouseId, item_id: itemId } = tankRows[0];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM fuel_deliveries WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const year = new Date(dto.delivery_date as string).getFullYear();
    const deliveryNo = `FD-${year}-${String(seq).padStart(6, '0')}`;

    const totalCost = parseFloat((receivedL15 * unitCost).toFixed(2));

    const headerRows = await client.query(
      `INSERT INTO fuel_deliveries
         (company_id, delivery_no, supplier_id, po_id, warehouse_id, tank_id, item_id,
          delivery_date, truck_plate_no, driver_name, bol_no,
          loaded_litres_15c, loaded_litres_obs, loaded_temp_c, loaded_density,
          received_litres_15c, received_litres_obs, received_temp_c, received_density,
          unit_cost, excise_tax_amount, vat_amount, total_cost,
          status, posted_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               $12,$13,$14,$15,
               $16,$17,$18,$19,
               $20,$21,$22,$23,
               'posted', now(), $24, $25)
       RETURNING id, delivery_no`,
      [
        companyId, deliveryNo, dto.supplier_id, (dto.po_id as string) || null,
        warehouseId, tankId, itemId,
        dto.delivery_date,
        (dto.truck_plate_no as string) || null,
        (dto.driver_name as string) || null,
        (dto.bol_no as string) || null,
        dto.loaded_litres_15c != null ? Number(dto.loaded_litres_15c) : null,
        dto.loaded_litres_obs != null ? Number(dto.loaded_litres_obs) : null,
        dto.loaded_temp_c != null ? Number(dto.loaded_temp_c) : null,
        dto.loaded_density != null ? Number(dto.loaded_density) : null,
        receivedL15, receivedObs,
        dto.received_temp_c != null ? Number(dto.received_temp_c) : null,
        dto.received_density != null ? Number(dto.received_density) : null,
        unitCost,
        dto.excise_tax_amount != null ? Number(dto.excise_tax_amount) : 0,
        dto.vat_amount != null ? Number(dto.vat_amount) : 0,
        totalCost,
        (dto.notes as string) || null,
        auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    // ── Post received L15 to inventory: weighted-average cost + movement row ──
    await client.query(
      `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (item_id, warehouse_id) DO UPDATE
         SET avg_cost = CASE
               WHEN stock_balances.qty_on_hand + $3 > 0
               THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4)
                      / (stock_balances.qty_on_hand + $3)
               ELSE $4
             END,
             qty_on_hand = stock_balances.qty_on_hand + $3,
             last_movement_at = now()`,
      [itemId, warehouseId, receivedL15, unitCost],
    );

    await client.query(
      `INSERT INTO stock_movements
         (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
          reference_type, reference_id, reference_no, created_by)
       VALUES ($1,$2,$3,'receipt',$4,$5,$6,'fuel_delivery',$7,$8,$9)`,
      [
        companyId, itemId, warehouseId,
        receivedL15, unitCost, totalCost,
        header.id, header.delivery_no, auth.userId,
      ],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','fuel_delivery',$3)`,
      [auth.userId, companyId, header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT fd.*, t.tank_no, i.name AS item_name, s.name AS supplier_name
         FROM fuel_deliveries fd
         JOIN fuel_tanks t ON t.id = fd.tank_id
         JOIN items i      ON i.id = fd.item_id
         JOIN suppliers s  ON s.id = fd.supplier_id
        WHERE fd.id = $1 LIMIT 1`,
      [header.id],
    );
    return ok(fullRows[0], 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (e as Error).message ?? 'Failed to post delivery';
    if (/unique|duplicate/i.test(msg)) return err('Delivery number collision — please retry', 409);
    return err(msg, 500);
  } finally {
    client.release();
  }
}
