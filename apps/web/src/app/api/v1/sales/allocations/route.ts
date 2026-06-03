export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const p = request.nextUrl.searchParams;
  const companyId = p.get('company_id');
  if (!companyId) return err('company_id required', 400);

  const status = p.get('status');
  const params: unknown[] = [companyId];
  let where = `oa.company_id = $1`;
  if (status) { params.push(status); where += ` AND oa.status = $${params.length}`; }

  const limit = Math.min(parseInt(p.get('limit') ?? '200'), 500);
  params.push(limit);

  const rows = await query(
    `SELECT oa.id, oa.allocation_no, oa.allocation_date, oa.delivery_date,
            oa.customer_name, oa.status, oa.with_si, oa.tally_sheet_id,
            c.name AS customer_name_live, c.code AS customer_code,
            so.order_no AS so_no
       FROM order_allocations oa
       JOIN customers c ON c.id = oa.customer_id
       LEFT JOIN sales_orders so ON so.id = oa.so_id
      WHERE ${where}
      ORDER BY oa.allocation_date DESC, oa.allocation_no DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null);
  if (!dto?.company_id || !dto?.customer_id) return err('company_id and customer_id required', 400);
  if (!dto?.allocation_date) return err('allocation_date required', 400);
  if (!Array.isArray(dto.lines) || dto.lines.length === 0) return err('At least one line required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM order_allocations WHERE company_id = $1`,
      [dto.company_id],
    );
    const seq = seqRows.rows[0].c + 1;
    const allocationNo = `OA-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    // Get customer name
    const custRows = await client.query(`SELECT name FROM customers WHERE id = $1`, [dto.customer_id]);
    const customerName = custRows.rows[0]?.name ?? '';

    const hdr = await client.query(
      `INSERT INTO order_allocations
         (company_id, allocation_no, so_id, customer_id, customer_name,
          allocation_date, delivery_date, reference, notes, with_si,
          branch_id, building_id, cost_center_id, grow_reference_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [dto.company_id, allocationNo, dto.so_id ?? null, dto.customer_id, customerName,
       dto.allocation_date, dto.delivery_date ?? null, dto.reference ?? null,
       dto.notes ?? null, dto.with_si ?? true,
       dto.branch_id ?? null, dto.building_id ?? null, dto.cost_center_id ?? null,
       dto.grow_reference_id ?? null, auth.userId],
    );
    const header = hdr.rows[0];

    for (let i = 0; i < dto.lines.length; i++) {
      const l = dto.lines[i];
      await client.query(
        `INSERT INTO order_allocation_lines
           (allocation_id, line_no, item_id, description,
            qty_ordered, qty_allocated, allocation_unit,
            unit_price, discount_pct, vat_rate,
            branch_id, building_id, cost_center_id, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [header.id, i + 1, l.item_id ?? null, l.description ?? '',
         l.qty_ordered ?? 0, l.qty_allocated ?? 0, l.allocation_unit ?? 'Pcs',
         l.unit_price ?? 0, l.discount_pct ?? 0, l.vat_rate ?? 12,
         l.branch_id ?? null, l.building_id ?? null, l.cost_center_id ?? null,
         l.grow_reference_id ?? null],
      );
    }

    await client.query('COMMIT');
    return ok({ id: header.id, allocation_no: allocationNo }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
