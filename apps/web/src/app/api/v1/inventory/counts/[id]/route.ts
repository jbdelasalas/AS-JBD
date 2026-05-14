export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT sc.*, w.name AS warehouse_name, u.full_name AS created_by_name
       FROM stock_counts sc
       JOIN warehouses w ON w.id = sc.warehouse_id
       JOIN users u ON u.id = sc.created_by
      WHERE sc.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Not found', 404);

  const lines = await query(
    `SELECT scl.*, i.sku, i.name AS item_name, i.uom
       FROM stock_count_lines scl
       JOIN items i ON i.id = scl.item_id
      WHERE scl.count_id = $1
      ORDER BY i.sku`,
    [params.id],
  );

  return ok({
    ...rows[0],
    lines: lines.map((l) => ({
      ...l,
      system_qty: Number(l.system_qty),
      counted_qty: Number(l.counted_qty),
      variance: Number(l.variance),
      unit_cost: Number(l.unit_cost),
      variance_value: Number(l.variance_value),
    })),
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const rows = await query(`SELECT status FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
  if (!rows[0]) return err('Not found', 404);
  if (rows[0].status !== 'in_progress') return err('Count must be in_progress to update counts', 400);

  // dto.lines = Array<{ line_id: string, counted_qty: number }>
  const updates = dto.lines as Array<{ line_id: string; counted_qty: number }>;
  if (!updates?.length) return err('lines required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        `UPDATE stock_count_lines
            SET counted_qty = $1,
                variance = $1 - system_qty,
                variance_value = ($1 - system_qty) * unit_cost
          WHERE id = $2 AND count_id = $3`,
        [Number(u.counted_qty), u.line_id, params.id],
      );
    }
    await client.query('COMMIT');
    return ok({ updated: updates.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
