export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const search = searchParams.get('search');
  const isActiveStr = searchParams.get('is_active');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  const params: unknown[] = [companyId];
  let where = `c.company_id = $1`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`;
  }
  if (isActiveStr !== null) {
    params.push(isActiveStr === 'true');
    where += ` AND c.is_active = $${params.length}`;
  }

  params.push(limit, offset);

  const rows = await query(
    `SELECT c.*,
            COALESCE(SUM(si.balance), 0) AS open_ar_balance
       FROM customers c
       LEFT JOIN sales_invoices si ON si.customer_id = c.id
         AND si.status IN ('open','partially_paid','overdue')
      WHERE ${where}
      GROUP BY c.id
      ORDER BY c.name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM customers c WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => ({
      ...r,
      credit_limit: Number((r as Record<string, unknown>).credit_limit),
      open_ar_balance: Number((r as Record<string, unknown>).open_ar_balance),
    })),
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
  if (!companyId || !dto.name) return err('company_id and name are required', 400);

  // Generate customer code
  const seqRows = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM customers WHERE company_id = $1`,
    [companyId],
  );
  const seq = seqRows[0].c + 1;
  const code = `CUST-${String(seq).padStart(6, '0')}`;

  const existing = await query(
    `SELECT id FROM customers WHERE company_id = $1 AND code = $2`,
    [companyId, code],
  );
  if (existing.length) return err(`Customer code ${code} already exists`, 409);

  const rows = await query(
    `INSERT INTO customers
       (company_id, code, name, customer_type, tin, address, contact_person,
        email, phone, payment_terms_days, credit_limit, is_vat_exempt, ar_account_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      companyId, code, dto.name,
      dto.customer_type ?? 'wholesale',
      dto.tin ?? null,
      dto.address ?? null,
      dto.contact_person ?? null,
      dto.email ?? null,
      dto.phone ?? null,
      dto.payment_terms_days ?? 30,
      dto.credit_limit ?? 0,
      dto.is_vat_exempt ?? false,
      dto.ar_account_id ?? null,
    ],
  );
  const customer = rows[0] as Record<string, unknown>;

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, companyId, 'create', 'customer', customer.id, JSON.stringify(customer)],
  ).catch(() => {/* non-fatal */});

  return ok({ ...customer, credit_limit: Number(customer.credit_limit) }, 201);
}
