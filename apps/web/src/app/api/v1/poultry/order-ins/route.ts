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
  let where = `o.company_id = $1`;
  if (status) { params.push(status); where += ` AND o.status = $${params.length}`; }

  params.push(limit, offset);
  try {
    const rows = await query(
      `SELECT o.id, o.doc_no, o.transaction_date, o.date_needed, o.status,
              o.total_amount, o.remarks, o.purchase_order_id,
              s.name AS supplier_name, s.code AS supplier_code,
              po.po_no
         FROM order_ins o
         JOIN suppliers s ON s.id = o.supplier_id
         LEFT JOIN purchase_orders po ON po.id = o.purchase_order_id
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM order_ins o WHERE ${where}`,
      params.slice(0, params.length - 2),
    );
    return ok({ data: rows.map(r => ({ ...r, total_amount: Number((r as Record<string,unknown>).total_amount) })), total: c });
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
        WHERE company_id = $1 AND doc_type = 'order_in' AND is_active = true
        RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for order_in', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const total = lines.reduce((s, l) => s + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0);

    // Auto-create a linked Purchase Order
    const poSeq = await client.query(`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id = $1`, [companyId]);
    const poNo = `PO-${new Date().getFullYear()}-${String(poSeq.rows[0].c + 1).padStart(6, '0')}`;
    const { rows: [po] } = await client.query(
      `INSERT INTO purchase_orders (company_id, branch_id, po_no, supplier_id, po_date, expected_date, reference,
         subtotal, vat_amount, total, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$8,'draft',$9) RETURNING id, po_no`,
      [companyId, dto.branch_id ?? null, poNo, dto.supplier_id,
       dto.transaction_date, dto.date_needed ?? null, dto.reference_no ?? null,
       total.toFixed(2), auth.userId],
    );

    const { rows: [hdr] } = await client.query(
      `INSERT INTO order_ins (company_id, doc_no, supplier_id, branch_id, reference_no, transaction_date, date_needed,
         delivery_method, payment_terms, remarks, notes, status, total_amount, purchase_order_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'saved',$12,$13,$14) RETURNING *`,
      [companyId, docNo, dto.supplier_id, dto.branch_id ?? null, dto.reference_no ?? null,
       dto.transaction_date, dto.date_needed ?? null, dto.delivery_method ?? null,
       dto.payment_terms ?? null, dto.remarks ?? null, dto.notes ?? null, total, po.id, auth.userId],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const amt = Number(l.quantity ?? 0) * Number(l.unit_price ?? 0);
      await client.query(
        `INSERT INTO order_in_lines (order_in_id, line_no, item_id, quantity, uom, unit_price, amount, remarks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [hdr.id, i + 1, l.item_id, l.quantity, l.uom ?? 'heads', l.unit_price ?? 0, amt, l.remarks ?? null],
      );
      // Mirror lines into the PO
      const itemRow = await client.query(`SELECT name FROM items WHERE id = $1`, [l.item_id]);
      const itemName = itemRow.rows[0]?.name ?? '';
      await client.query(
        `INSERT INTO purchase_order_lines (po_id, line_no, item_id, description, quantity, qty_received, unit_price, vat_rate, line_total)
         VALUES ($1,$2,$3,$4,$5,0,$6,0,$7)`,
        [po.id, i + 1, l.item_id, itemName, l.quantity, l.unit_price ?? 0, amt.toFixed(2)],
      );
    }
    await client.query('COMMIT');
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1,$2,'create','order_in',$3,$4)`,
      [auth.userId, companyId, hdr.id, JSON.stringify({ ...hdr, po_no: po.po_no })]).catch(() => {});
    return ok({ ...hdr, po_no: po.po_no }, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
