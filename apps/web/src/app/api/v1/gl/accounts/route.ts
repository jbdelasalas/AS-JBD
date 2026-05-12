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

  const activeOnly = searchParams.get('active_only') === 'true';
  const type = searchParams.get('type');

  const params: unknown[] = [companyId];
  let where = `company_id = $1`;
  if (activeOnly) where += ` AND is_active = true`;
  if (type) {
    params.push(type);
    where += ` AND account_type = $${params.length}`;
  }

  const rows = await query(
    `SELECT id, code, name, account_type, parent_id, currency, is_active, is_control, description
       FROM accounts
      WHERE ${where}
      ORDER BY code`,
    params,
  );

  return ok(rows);
}

export async function POST(request: NextRequest) {
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

  const { company_id, code, name, account_type, parent_id, currency, is_control, description } = body as {
    company_id: string;
    code: string;
    name: string;
    account_type: string;
    parent_id?: string | null;
    currency?: string;
    is_control?: boolean;
    description?: string | null;
  };

  if (!company_id || !code || !name || !account_type) {
    return err('company_id, code, name, and account_type are required', 400);
  }

  const dup = await query(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
    [company_id, code],
  );
  if (dup[0]) return err(`Account code ${code} already exists`, 409);

  const rows = await query(
    `INSERT INTO accounts (company_id, code, name, account_type, parent_id, currency, is_control, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, code, name, account_type, parent_id, currency, is_active, is_control, description`,
    [
      company_id, code, name, account_type,
      parent_id ?? null,
      currency ?? 'PHP',
      is_control ?? false,
      description ?? null,
    ],
  );
  const created = rows[0];

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, company_id, 'create', 'account', (created as Record<string, unknown>).id, JSON.stringify(created)],
  ).catch(() => {/* non-fatal */});

  return ok(created, 201);
}
