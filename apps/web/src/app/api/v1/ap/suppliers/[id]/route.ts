export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const rows = await query(
    `SELECT * FROM suppliers WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Supplier ${params.id} not found`, 404);

  return ok(rows[0]);
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

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const existing = await query(
    `SELECT id, company_id FROM suppliers WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!existing[0]) return err(`Supplier ${params.id} not found`, 404);
  const sup = existing[0] as Record<string, unknown>;

  const allowed = ['name','supplier_type','tin','address','contact_person','email','phone',
    'payment_terms_days','is_vat_registered','ewt_rate','is_active','ap_account_id'];
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const key of allowed) {
    if (key in dto) {
      vals.push(dto[key]);
      sets.push(`${key} = $${vals.length}`);
    }
  }

  if (!sets.length) return err('No updatable fields provided', 400);
  vals.push(params.id);

  const rows = await query(
    `UPDATE suppliers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING *`,
    vals,
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, sup.company_id, 'update', 'supplier', params.id, JSON.stringify(rows[0])],
  ).catch(() => {/* non-fatal */});

  return ok(rows[0]);
}
