export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const allocRows = await query(
    `SELECT oa.*, c.name AS customer_name FROM order_allocations oa
       JOIN customers c ON c.id = oa.customer_id
      WHERE oa.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!allocRows[0]) return err('Allocation not found', 404);
  const alloc = allocRows[0] as Record<string, unknown>;
  if (alloc.status !== 'draft') return err('Only draft allocations can be posted', 400);

  const lines = await query(
    `SELECT * FROM order_allocation_lines WHERE allocation_id = $1 ORDER BY line_no`,
    [params.id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Generate tally sheet number
    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM sales_tally_sheets WHERE company_id = $1`,
      [alloc.company_id],
    );
    const seq = seqRows.rows[0].c + 1;
    const tallyNo = `ST-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    // Create tally sheet
    const tsRows = await client.query(
      `INSERT INTO sales_tally_sheets
         (company_id, tally_no, allocation_id, customer_id, customer_name,
          tally_date, delivery_date, reference, notes,
          branch_id, building_id, cost_center_id, grow_reference_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [alloc.company_id, tallyNo, params.id, alloc.customer_id, alloc.customer_name,
       alloc.allocation_date, alloc.delivery_date ?? null,
       alloc.reference ?? null, alloc.notes ?? null,
       alloc.branch_id ?? null, alloc.building_id ?? null,
       alloc.cost_center_id ?? null, alloc.grow_reference_id ?? null, auth.userId],
    );
    const tallyId = tsRows.rows[0].id;

    // Copy allocation lines to tally lines
    for (const l of lines) {
      const line = l as Record<string, unknown>;
      await client.query(
        `INSERT INTO sales_tally_lines
           (tally_id, line_no, allocation_line_id, item_id, description,
            qty_allocated, allocation_unit, actual_qty, actual_weight_kgs, unit_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8)`,
        [tallyId, line.line_no, line.id, line.item_id ?? null, line.description,
         line.qty_allocated, line.allocation_unit, line.unit_price],
      );
    }

    // Update allocation status and link tally sheet
    await client.query(
      `UPDATE order_allocations
          SET status = 'posted', tally_sheet_id = $1,
              posted_by = $2, posted_at = now(), updated_at = now()
        WHERE id = $3`,
      [tallyId, auth.userId, params.id],
    );

    await client.query('COMMIT');
    return ok({ tally_sheet_id: tallyId, tally_no: tallyNo });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
