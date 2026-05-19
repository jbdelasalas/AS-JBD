export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    amount: Number(r.amount),
    unapplied_amount: Number(r.unapplied_amount ?? 0),
  };
}

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
  let where = `cp.company_id = $1`;

  const status = searchParams.get('status');
  const customerId = searchParams.get('customer_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (status) { params.push(status); where += ` AND cp.status = $${params.length}`; }
  if (customerId) { params.push(customerId); where += ` AND cp.customer_id = $${params.length}`; }
  if (fromDate) { params.push(fromDate); where += ` AND cp.payment_date >= $${params.length}`; }
  if (toDate) { params.push(toDate); where += ` AND cp.payment_date <= $${params.length}`; }

  const invoiceId = searchParams.get('invoice_id');
  if (invoiceId) {
    const rows = await query(
      `SELECT cp.id, cp.receipt_no, cp.payment_date, cp.payment_method, cp.amount, cp.status,
              pa.amount_applied, c.name AS customer_name
         FROM customer_payments cp
         JOIN payment_applications pa ON pa.payment_id = cp.id
         JOIN customers c ON c.id = cp.customer_id
        WHERE cp.company_id = $1 AND pa.invoice_id = $2
        ORDER BY cp.payment_date DESC`,
      [companyId, invoiceId],
    );
    return ok({ data: rows.map((r) => ({ ...mapRow(r as Record<string, unknown>), amount_applied: Number((r as Record<string, unknown>).amount_applied) })), total: rows.length });
  }

  params.push(limit, offset);
  const rows = await query(
    `SELECT cp.id, cp.receipt_no, cp.payment_date, cp.payment_method, cp.amount, cp.unapplied_amount, cp.is_advance, cp.status,
            c.name AS customer_name, c.code AS customer_code
       FROM customer_payments cp
       JOIN customers c ON c.id = cp.customer_id
      WHERE ${where}
      ORDER BY cp.payment_date DESC, cp.receipt_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM customer_payments cp WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => mapRow(r as Record<string, unknown>)),
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
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
  const customerId = dto.customer_id as string;
  const amount = Number(dto.amount);

  if (!companyId || !customerId) return err('company_id and customer_id are required', 400);
  if (amount <= 0) return err('Payment amount must be positive', 400);

  const customers = await query(
    `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [customerId, companyId],
  );
  if (!customers[0]) return err('Customer not found or inactive', 404);

  const applications = (dto.applications as Array<{ invoice_id: string; amount_applied: number }>) ?? [];
  const appTotal = applications.reduce((s, a) => s + a.amount_applied, 0);
  if (appTotal > amount + 0.0001) return err('Applied amounts exceed payment amount', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = current_number + 1, updated_at = now() WHERE company_id = $1 AND doc_type = $2 AND is_active = true RETURNING prefix, current_number`,
      [companyId, 'official_receipt'],
    );
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active document series for official_receipt', 400); }
    const receiptNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;
    const unapplied = amount - appTotal;

    const headerRows = await client.query(
      `INSERT INTO customer_payments (company_id, branch_id, receipt_no, customer_id, payment_date, payment_method, reference, bank_ref, check_date, amount, unapplied_amount, is_advance, bank_account_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15) RETURNING *`,
      [
        companyId, dto.branch_id ?? null, receiptNo, customerId,
        dto.payment_date, dto.payment_method,
        dto.reference ?? null, dto.bank_ref ?? null, dto.check_date ?? null,
        amount.toFixed(2), unapplied.toFixed(2),
        dto.is_advance ?? (appTotal === 0),
        dto.bank_account_id ?? null, dto.notes ?? null, auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (const app of applications) {
      const invRows = await client.query(
        `SELECT id, balance, status, customer_id FROM sales_invoices WHERE id = $1 FOR UPDATE`,
        [app.invoice_id],
      );
      if (!invRows.rows[0]) { await client.query('ROLLBACK'); return err(`Invoice ${app.invoice_id} not found`, 404); }
      const inv = invRows.rows[0] as Record<string, unknown>;

      if (inv.customer_id !== customerId) {
        await client.query('ROLLBACK');
        return err(`Invoice ${app.invoice_id} belongs to a different customer`, 400);
      }
      if (!['open', 'partially_paid', 'overdue'].includes(inv.status as string)) {
        await client.query('ROLLBACK');
        return err(`Invoice ${app.invoice_id} is ${inv.status}`, 400);
      }

      const invBalance = Number(inv.balance);
      if (app.amount_applied > invBalance + 0.0001) {
        await client.query('ROLLBACK');
        return err(`Cannot apply ${app.amount_applied} to invoice with balance ${invBalance.toFixed(2)}`, 400);
      }

      await client.query(
        `INSERT INTO payment_applications (payment_id, invoice_id, amount_applied) VALUES ($1,$2,$3)`,
        [header.id, app.invoice_id, app.amount_applied],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'customer_payment', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    // Fetch full record
    const fullHeaders = await query(
      `SELECT cp.*, c.name AS customer_name, c.code AS customer_code FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE cp.id = $1 LIMIT 1`,
      [header.id],
    );
    const apps = await query(
      `SELECT pa.*, si.invoice_no FROM payment_applications pa JOIN sales_invoices si ON si.id = pa.invoice_id WHERE pa.payment_id = $1`,
      [header.id],
    );

    return ok({
      ...mapRow(fullHeaders[0] as Record<string, unknown>),
      applications: apps.map((a) => ({ ...a, amount_applied: Number((a as Record<string, unknown>).amount_applied) })),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
