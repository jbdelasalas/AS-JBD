export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
    amount_applied: Number(r.amount_applied ?? 0),
    balance: Number(r.balance),
  };
}

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `cm.company_id = $1`;

  const status = searchParams.get('status');
  const supplierId = searchParams.get('supplier_id');
  if (status) { params.push(status); where += ` AND cm.status = $${params.length}`; }
  if (supplierId) { params.push(supplierId); where += ` AND cm.supplier_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT cm.id, cm.memo_no, cm.memo_date, cm.status,
            cm.subtotal, cm.vat_amount, cm.total, cm.amount_applied, cm.balance,
            s.name AS supplier_name, s.code AS supplier_code
       FROM bill_credit_memos cm
       JOIN suppliers s ON s.id = cm.supplier_id
      WHERE ${where}
      ORDER BY cm.memo_date DESC, cm.memo_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM bill_credit_memos cm WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map(r => mapRow(r as Record<string, unknown>)),
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

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines?.length) return err('Credit memo must have at least one line', 400);

  const companyId = dto.company_id as string;
  const supplierId = dto.supplier_id as string;
  if (!companyId || !supplierId) return err('company_id and supplier_id are required', 400);
  if (!dto.memo_date) return err('memo_date is required', 400);

  const supplierRows = await query(
    `SELECT id FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [supplierId, companyId],
  );
  if (!supplierRows[0]) return err('Supplier not found or inactive', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Ensure table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS bill_credit_memos (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id     uuid NOT NULL,
        supplier_id    uuid NOT NULL,
        bill_id        uuid,
        memo_no        text NOT NULL,
        memo_date      date NOT NULL,
        reason         text,
        subtotal       numeric(18,2) NOT NULL DEFAULT 0,
        vat_amount     numeric(18,2) NOT NULL DEFAULT 0,
        total          numeric(18,2) NOT NULL DEFAULT 0,
        amount_applied numeric(18,2) NOT NULL DEFAULT 0,
        balance        numeric(18,2) NOT NULL DEFAULT 0,
        status         text NOT NULL DEFAULT 'draft',
        je_id          uuid,
        branch_id      uuid,
        building_id    uuid,
        cost_center_id uuid,
        grow_reference_id uuid,
        notes          text,
        created_by     uuid,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bill_credit_memo_lines (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        memo_id        uuid NOT NULL REFERENCES bill_credit_memos(id) ON DELETE CASCADE,
        line_no        int NOT NULL,
        description    text NOT NULL,
        expense_account_id uuid,
        quantity       numeric(18,4) NOT NULL DEFAULT 1,
        unit_price     numeric(18,4) NOT NULL DEFAULT 0,
        vat_rate       numeric(6,2)  NOT NULL DEFAULT 0,
        line_subtotal  numeric(18,2) NOT NULL DEFAULT 0,
        line_vat       numeric(18,2) NOT NULL DEFAULT 0,
        line_total     numeric(18,2) NOT NULL DEFAULT 0,
        branch_id      uuid,
        building_id    uuid,
        cost_center_id uuid,
        grow_reference_id uuid,
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `);

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM bill_credit_memos WHERE company_id = $1`, [companyId]);
    const seq = seqRows.rows[0].c + 1;
    const memoNo = `BCM-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const mappedLines = (lines as Array<Record<string, unknown>>).map((l, idx) => {
      const qty = Number(l.quantity ?? 1);
      const price = Number(l.unit_price ?? 0);
      const vatRate = Number(l.vat_rate ?? 0);
      const lineSubtotal = parseFloat((qty * price).toFixed(2));
      const lineVat = parseFloat((lineSubtotal * vatRate / 100).toFixed(2));
      const lineTotal = parseFloat((lineSubtotal + lineVat).toFixed(2));
      return { ...l, line_no: idx + 1, qty, price, vatRate, lineSubtotal, lineVat, lineTotal };
    });

    const totSubtotal = mappedLines.reduce((s, l) => s + l.lineSubtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.lineVat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.lineTotal, 0);

    const headerRows = await client.query(
      `INSERT INTO bill_credit_memos
         (company_id, supplier_id, bill_id, memo_no, memo_date, reason,
          subtotal, vat_amount, total, balance,
          branch_id, building_id, cost_center_id, grow_reference_id, notes,
          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,'draft',$15)
       RETURNING *`,
      [companyId, supplierId, dto.bill_id ?? null, memoNo, dto.memo_date,
       dto.reason ?? null,
       totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2),
       dto.branch_id ?? null, dto.building_id ?? null,
       dto.cost_center_id ?? null, dto.grow_reference_id ?? null,
       dto.notes ?? null, auth.userId],
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO bill_credit_memo_lines
           (memo_id, line_no, description, expense_account_id,
            quantity, unit_price, vat_rate, line_subtotal, line_vat, line_total,
            branch_id, building_id, cost_center_id, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [header.id, l.line_no, l.description, l.expense_account_id ?? null,
         l.qty, l.price, l.vatRate,
         l.lineSubtotal.toFixed(2), l.lineVat.toFixed(2), l.lineTotal.toFixed(2),
         (l as Record<string, unknown>).branch_id ?? null,
         (l as Record<string, unknown>).building_id ?? null,
         (l as Record<string, unknown>).cost_center_id ?? null,
         (l as Record<string, unknown>).grow_reference_id ?? null],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'create','bill_credit_memo',$3)`,
      [auth.userId, companyId, header.id],
    ).catch(() => {});

    await client.query('COMMIT');
    return ok({ ...mapRow(header), lines: mappedLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
