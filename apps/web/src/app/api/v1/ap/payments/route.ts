export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `sp.company_id = $1`;

  const status = searchParams.get('status');
  const supplierId = searchParams.get('supplier_id');

  if (status) { params.push(status); where += ` AND sp.status = $${params.length}`; }
  if (supplierId) { params.push(supplierId); where += ` AND sp.supplier_id = $${params.length}`; }

  params.push(limit, offset);

  try {
    const rows = await query(
      `SELECT sp.id, sp.voucher_no, sp.payment_date, sp.payment_method, sp.reference,
              sp.amount, sp.status,
              s.name AS supplier_name, s.code AS supplier_code
         FROM supplier_payments sp
         JOIN suppliers s ON s.id = sp.supplier_id
        WHERE ${where}
        ORDER BY sp.payment_date DESC, sp.voucher_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM supplier_payments sp WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return ok({
      data: rows.map((r) => ({ ...r, amount: Number((r as Record<string, unknown>).amount) })),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const companyId = dto.company_id as string;
  const supplierId = dto.supplier_id as string;
  if (!companyId || !supplierId) return err('company_id and supplier_id are required', 400);
  if (!dto.payment_date || !dto.amount) return err('payment_date and amount are required', 400);

  const suppliers = await query(
    `SELECT id FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [supplierId, companyId],
  );
  if (!suppliers[0]) return err('Supplier not found or inactive', 404);

  const amount = Number(dto.amount);
  if (amount <= 0) return err('Amount must be positive', 400);

  const billIds = (dto.bill_ids as string[]) ?? [];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM supplier_payments WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const voucherNo = `CV-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO supplier_payments
         (company_id, voucher_no, supplier_id, payment_date, payment_method,
          reference, amount, bank_account_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
       RETURNING *`,
      [
        companyId, voucherNo, supplierId,
        dto.payment_date, dto.payment_method ?? 'bank_transfer',
        dto.reference ?? null, amount.toFixed(2),
        dto.bank_account_id ?? null, auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    let remaining = amount;
    for (const billId of billIds) {
      if (remaining <= 0) break;
      const billRows = await client.query(
        `SELECT id, balance FROM bills WHERE id = $1 AND supplier_id = $2 AND status = 'approved' FOR UPDATE`,
        [billId, supplierId],
      );
      if (!billRows.rows[0]) continue;
      const bill = billRows.rows[0];
      const billBalance = Number(bill.balance);
      const applying = Math.min(remaining, billBalance);

      await client.query(
        `INSERT INTO bill_payment_applications (payment_id, bill_id, amount_applied)
         VALUES ($1, $2, $3)`,
        [header.id, billId, applying.toFixed(2)],
      );

      const newBalance = parseFloat((billBalance - applying).toFixed(2));
      const newAmountPaid = parseFloat(
        (await client.query(`SELECT amount_paid FROM bills WHERE id = $1`, [billId])).rows[0].amount_paid
      ) + applying;

      await client.query(
        `UPDATE bills
            SET amount_paid = $1, balance = $2,
                status = CASE WHEN $2 <= 0 THEN 'paid' ELSE status END,
                updated_at = now()
          WHERE id = $3`,
        [newAmountPaid.toFixed(2), newBalance.toFixed(2), billId],
      );

      remaining -= applying;
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'supplier_payment', header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT sp.*, s.name AS supplier_name, s.code AS supplier_code
         FROM supplier_payments sp
         JOIN suppliers s ON s.id = sp.supplier_id
        WHERE sp.id = $1 LIMIT 1`,
      [header.id],
    );
    const applications = await query(
      `SELECT bpa.*, b.internal_no, b.bill_no
         FROM bill_payment_applications bpa
         JOIN bills b ON b.id = bpa.bill_id
        WHERE bpa.payment_id = $1`,
      [header.id],
    );

    return ok({
      ...fullRows[0],
      amount: Number((fullRows[0] as Record<string, unknown>).amount),
      applications: applications.map((a) => ({
        ...a,
        amount_applied: Number((a as Record<string, unknown>).amount_applied),
      })),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
