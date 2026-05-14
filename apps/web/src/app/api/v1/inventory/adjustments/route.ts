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
  let where = `sa.company_id = $1`;

  const status = searchParams.get('status');
  const warehouseId = searchParams.get('warehouse_id');
  if (status) { params.push(status); where += ` AND sa.status = $${params.length}`; }
  if (warehouseId) { params.push(warehouseId); where += ` AND sa.warehouse_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT sa.id, sa.adj_no, sa.reason_code, sa.status, sa.created_at, sa.posted_at, sa.notes,
            w.name AS warehouse_name,
            u.full_name AS created_by_name
       FROM stock_adjustments sa
       JOIN warehouses w ON w.id = sa.warehouse_id
       JOIN users u ON u.id = sa.created_by
      WHERE ${where}
      ORDER BY sa.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM stock_adjustments sa WHERE ${where}`,
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
  const reasonCode = dto.reason_code as string;
  const lines = dto.lines as Array<Record<string, unknown>>;

  if (!companyId || !warehouseId || !reasonCode) return err('company_id, warehouse_id, reason_code required', 400);
  if (!lines?.length) return err('At least one line required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM stock_adjustments WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const adjNo = `ADJ-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO stock_adjustments (company_id, adj_no, warehouse_id, reason_code, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, adjNo, warehouseId, reasonCode, dto.notes ?? null, auth.userId],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const qtyChange = Number(l.qty_change);
      const unitCost = Number(l.unit_cost ?? 0);
      await client.query(
        `INSERT INTO stock_adjustment_lines (adj_id, line_no, item_id, qty_change, unit_cost, line_total, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, i + 1, l.item_id, qtyChange, unitCost, Math.abs(qtyChange) * unitCost, l.notes ?? null],
      );
    }

    await client.query('COMMIT');

    const full = await query(
      `SELECT sa.*, w.name AS warehouse_name FROM stock_adjustments sa
       JOIN warehouses w ON w.id = sa.warehouse_id WHERE sa.id = $1 LIMIT 1`,
      [header.id],
    );
    const adjLines = await query(
      `SELECT sal.*, i.sku, i.name AS item_name, i.uom
         FROM stock_adjustment_lines sal JOIN items i ON i.id = sal.item_id
        WHERE sal.adj_id = $1 ORDER BY sal.line_no`,
      [header.id],
    );
    return ok({ ...full[0], lines: adjLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
