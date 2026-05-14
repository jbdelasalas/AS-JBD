export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `sc.company_id = $1`;

  const status = searchParams.get('status');
  const warehouseId = searchParams.get('warehouse_id');
  if (status) { params.push(status); where += ` AND sc.status = $${params.length}`; }
  if (warehouseId) { params.push(warehouseId); where += ` AND sc.warehouse_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT sc.id, sc.count_no, sc.count_type, sc.status, sc.created_at, sc.started_at, sc.posted_at, sc.notes,
            w.name AS warehouse_name,
            (SELECT COUNT(*) FROM stock_count_lines scl WHERE scl.count_id = sc.id) AS line_count
       FROM stock_counts sc
       JOIN warehouses w ON w.id = sc.warehouse_id
      WHERE ${where}
      ORDER BY sc.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM stock_counts sc WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({ data: rows, total: countRows[0].c });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const warehouseId = dto.warehouse_id as string;
  const countType = (dto.count_type as string) ?? 'FULL';

  if (!companyId || !warehouseId) return err('company_id and warehouse_id required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM stock_counts WHERE company_id = $1`, [companyId],
    );
    const countNo = `CNT-${new Date().getFullYear()}-${String(seqRows.rows[0].c + 1).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO stock_counts (company_id, count_no, warehouse_id, count_type, notes, status, started_at, started_by, created_by)
       VALUES ($1,$2,$3,$4,$5,'in_progress',now(),$6,$6) RETURNING *`,
      [companyId, countNo, warehouseId, countType, dto.notes ?? null, auth.userId],
    );
    const header = headerRows.rows[0];

    // Snapshot current stock balances for the warehouse as system_qty
    const balanceRows = await client.query(
      `SELECT sb.item_id, sb.qty_on_hand, COALESCE(sb.avg_cost, i.standard_cost) AS avg_cost
         FROM stock_balances sb
         JOIN items i ON i.id = sb.item_id
        WHERE sb.warehouse_id = $1 AND i.company_id = $2 AND i.is_active = true
        ORDER BY i.sku`,
      [warehouseId, companyId],
    );

    for (const b of balanceRows.rows) {
      await client.query(
        `INSERT INTO stock_count_lines (count_id, item_id, system_qty, unit_cost, counted_qty, variance, variance_value)
         VALUES ($1,$2,$3,$4,0,0,0)`,
        [header.id, b.item_id, Number(b.qty_on_hand), Number(b.avg_cost)],
      );
    }

    await client.query('COMMIT');

    const full = await query(
      `SELECT sc.*, w.name AS warehouse_name FROM stock_counts sc
       JOIN warehouses w ON w.id = sc.warehouse_id WHERE sc.id = $1 LIMIT 1`,
      [header.id],
    );
    return ok(full[0], 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
