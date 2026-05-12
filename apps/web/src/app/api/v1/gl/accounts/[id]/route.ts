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
    `SELECT id, company_id, code, name, account_type, parent_id, currency, is_active, is_control, description
       FROM accounts WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err(`Account ${params.id} not found`, 404);
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const existing = await query(
    `SELECT * FROM accounts WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!existing[0]) return err(`Account ${params.id} not found`, 404);

  const updatable = ['code', 'name', 'account_type', 'parent_id', 'currency', 'is_active', 'is_control', 'description'];
  const sets: string[] = [];
  const queryParams: unknown[] = [];

  for (const key of updatable) {
    if (body[key] !== undefined) {
      queryParams.push(body[key]);
      sets.push(`${key} = $${queryParams.length}`);
    }
  }

  if (!sets.length) return ok(existing[0]);

  queryParams.push(params.id);
  const updated = await query(
    `UPDATE accounts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${queryParams.length}
     RETURNING id, company_id, code, name, account_type, parent_id, currency, is_active, is_control, description`,
    queryParams,
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, (existing[0] as Record<string, unknown>).company_id, 'update', 'account', params.id, JSON.stringify(body)],
  ).catch(() => {/* non-fatal */});

  return ok(updated[0]);
}
