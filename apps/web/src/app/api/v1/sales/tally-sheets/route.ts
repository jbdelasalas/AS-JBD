export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!dto) return err('Invalid body', 400);

  const companyId = dto.company_id as string;
  if (!companyId || !dto.customer_id) return err('company_id and customer_id required', 400);

  const seqRows = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM sales_tally_sheets WHERE company_id = $1`, [companyId]);
  const seq = seqRows[0].c + 1;
  const tallyNo = `ST-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

  const rows = await query(
    `INSERT INTO sales_tally_sheets
       (company_id, tally_no, customer_id, customer_name, so_id, poultry_tally_id,
        tally_date, delivery_date, reference, notes,
        branch_id, building_id, cost_center_id, grow_reference_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id, tally_no`,
    [companyId, tallyNo, dto.customer_id, dto.customer_name ?? null,
     dto.so_id ?? null, dto.poultry_tally_id ?? null,
     dto.tally_date ?? new Date().toISOString().split('T')[0],
     dto.delivery_date ?? null, dto.reference ?? null, dto.notes ?? null,
     dto.branch_id ?? null, dto.building_id ?? null,
     dto.cost_center_id ?? null, dto.grow_reference_id ?? null, auth.userId],
  );
  const tally = rows[0] as Record<string, unknown>;

  const lines = (dto.lines as Array<Record<string, unknown>> | undefined) ?? [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await query(
      `INSERT INTO sales_tally_lines
         (tally_id, line_no, item_id, description,
          qty_allocated, allocation_unit, actual_qty, actual_weight_kgs, unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tally.id, i + 1, l.item_id ?? null, l.description ?? '',
       l.qty_allocated ?? 0, l.allocation_unit ?? 'Pcs',
       l.actual_qty ?? 0, l.actual_weight_kgs ?? 0, l.unit_price ?? 0],
    );
  }

  return ok(tally, 201);
}

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) return err('company_id required', 400);

  const rows = await query(
    `SELECT st.id, st.tally_no, st.tally_date, st.delivery_date,
            st.customer_name, st.status, st.allocation_id,
            c.name AS customer_name_live, c.code AS customer_code,
            oa.allocation_no
       FROM sales_tally_sheets st
       JOIN customers c ON c.id = st.customer_id
       LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
      WHERE st.company_id = $1
      ORDER BY st.tally_date DESC, st.tally_no DESC
      LIMIT 200`,
    [companyId],
  );
  return ok({ data: rows });
}
