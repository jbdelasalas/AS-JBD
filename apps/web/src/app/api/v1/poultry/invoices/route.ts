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
      `SELECT i.id, i.doc_no, i.invoice_date, i.due_date, i.status, i.payment_status,
              i.total_amount, i.paid_amount, i.balance_due,
              c.name AS customer_name, c.code AS customer_code
         FROM poultry_invoices i JOIN customers c ON c.id = i.customer_id
        WHERE ${where} ORDER BY i.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const [{ c }] = await query<{ c: number }>(`SELECT count(*)::int AS c FROM poultry_invoices i WHERE ${where}`, params.slice(0, params.length - 2));
    return ok({ data: rows.map(r => ({ ...r, total_amount: Number((r as Record<string,unknown>).total_amount), balance_due: Number((r as Record<string,unknown>).balance_due) })), total: c });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.customer_id || !dto.invoice_date) return err('company_id, customer_id, and invoice_date are required', 400);
  const lines = (dto.lines as Record<string, unknown>[]) ?? [];
  if (!lines.length) return err('At least one line is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ser = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'poultry_invoice' AND is_active = true RETURNING prefix, current_number`,
      [companyId],
    );
    if (!ser.rows[0]) { await client.query('ROLLBACK'); return err('No active series for poultry_invoice', 400); }
    const docNo = `${ser.rows[0].prefix}${String(ser.rows[0].current_number).padStart(6, '0')}`;

    const subtotal = lines.reduce((s, l) => {
      const kgs = Number(l.kgs ?? 0);
      const price = Number(l.unit_price ?? 0);
      const disc = Number(l.discount_pct ?? 0);
      return s + kgs * price * (1 - disc / 100);
    }, 0);
    const vatAmt = lines.reduce((s, l) => {
      const kgs = Number(l.kgs ?? 0);
      const price = Number(l.unit_price ?? 0);
      const disc = Number(l.discount_pct ?? 0);
      const base = kgs * price * (1 - disc / 100);
      return s + base * (Number(l.vat_rate ?? 0) / 100);
    }, 0);
    const total = subtotal + vatAmt;
    const terms = Number(dto.payment_terms ?? 30);
    const invDate = dto.invoice_date as string;
    const dueDate = dto.due_date ?? new Date(new Date(invDate).getTime() + terms * 86400000).toISOString().split('T')[0];

    const { rows: [hdr] } = await client.query(
      `INSERT INTO poultry_invoices (company_id, doc_no, delivery_id, customer_id, invoice_date, due_date, payment_terms,
         subtotal, vat_amount, total_amount, paid_amount, balance_due, payment_status, status, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$10,'unpaid','draft',$11,$12) RETURNING *`,
      [companyId, docNo, dto.delivery_id ?? null, dto.customer_id, invDate, dueDate, terms,
       subtotal, vatAmt, total, dto.remarks ?? null, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const base = Number(l.kgs ?? 0) * Number(l.unit_price ?? 0) * (1 - Number(l.discount_pct ?? 0) / 100);
      await client.query(
        `INSERT INTO poultry_invoice_lines (invoice_id, line_no, item_id, description, heads, kgs, unit_price, discount_pct, amount, vat_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [hdr.id, i + 1, l.item_id, l.description ?? null, l.heads ?? 0, l.kgs ?? 0, l.unit_price ?? 0, l.discount_pct ?? 0, base, l.vat_rate ?? 12],
      );
    }
    await client.query('COMMIT');
    return ok(hdr, 201);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
