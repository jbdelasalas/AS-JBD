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
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `i.company_id = $1`;
  if (status) { params.push(status); where += ` AND i.status = $${params.length}`; }
  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT i.id, i.doc_no, i.transaction_date, i.status, i.remarks,
              s.name AS supplier_name, s.code AS supplier_code
         FROM inventory_ins i JOIN suppliers s ON s.id = i.supplier_id
        WHERE ${where} ORDER BY i.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM inventory_ins i WHERE ${where}`,
      params.slice(0, params.length - 2),
    );
    return ok({ data: rows, total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.supplier_id || !dto.transaction_date)
    return err('company_id, supplier_id, and transaction_date are required', 400);
  const lines = (dto.lines as Record<string, unknown>[]) ?? [];
  if (!lines.length) return err('At least one line is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'inventory_in' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for inventory_in', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const { rows: [hdr] } = await client.query(
      `INSERT INTO inventory_ins (company_id, doc_no, order_in_id, supplier_id, warehouse_id, branch_id,
         transaction_date, delivery_method, contact_person, remarks, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'saved',$12) RETURNING *`,
      [companyId, docNo, dto.order_in_id ?? null, dto.supplier_id, dto.warehouse_id ?? null,
       dto.branch_id ?? null, dto.transaction_date, dto.delivery_method ?? null,
       dto.contact_person ?? null, dto.remarks ?? null, dto.notes ?? null, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const net = Number(l.quantity_received ?? 0) - Number(l.quantity_doa ?? 0);
      await client.query(
        `INSERT INTO inventory_in_lines (inventory_in_id, line_no, item_id, batch_no, quantity_received, quantity_doa, net_quantity, unit_cost, total_cost, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [hdr.id, i + 1, l.item_id, l.batch_no ?? null, l.quantity_received, l.quantity_doa ?? 0,
         net, l.unit_cost ?? 0, net * Number(l.unit_cost ?? 0), l.remarks ?? null],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
