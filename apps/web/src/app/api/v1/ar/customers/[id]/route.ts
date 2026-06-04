export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

async function findCustomer(id: string) {
  const rows = await query(
    `SELECT c.*,
            COALESCE(SUM(si.balance), 0) AS open_ar_balance,
            a.code AS ar_account_code,
            a.name AS ar_account_name
       FROM customers c
       LEFT JOIN sales_invoices si ON si.customer_id = c.id
         AND si.status IN ('open','partially_paid','overdue')
       LEFT JOIN accounts a ON a.id = c.ar_account_id
      WHERE c.id = $1
      GROUP BY c.id, a.code, a.name`,
    [id],
  );
  if (!rows[0]) return null;
  const r = rows[0] as Record<string, unknown>;
  return { ...r, credit_limit: Number(r.credit_limit), open_ar_balance: Number(r.open_ar_balance) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const customer = await findCustomer(params.id);
  if (!customer) return err(`Customer ${params.id} not found`, 404);
  return ok(customer);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const customer = await findCustomer(params.id);
  if (!customer) return err(`Customer ${params.id} not found`, 404);

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const updatable = [
    'name', 'customer_type', 'tin', 'address', 'contact_person',
    'email', 'phone', 'payment_terms_days', 'credit_limit',
    'is_vat_exempt', 'ar_account_id', 'is_active',
  ];

  const sets: string[] = [];
  const queryParams: unknown[] = [];

  for (const key of updatable) {
    if (dto[key] !== undefined) {
      queryParams.push(dto[key]);
      sets.push(`${key} = $${queryParams.length}`);
    }
  }

  if (!sets.length) return ok(customer);

  queryParams.push(params.id);
  await query(
    `UPDATE customers SET ${sets.join(', ')} WHERE id = $${queryParams.length}`,
    queryParams,
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, (customer as Record<string, unknown>).company_id, 'update', 'customer', params.id, JSON.stringify(dto)],
  ).catch(() => {/* non-fatal */});

  const updated = await findCustomer(params.id);
  return ok(updated);
}
