import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');
    if (!companyId) return err('company_id required', 400);

    const rows = await query<{
      id: string; code: string; name: string; account_id: string | null;
      requires_reference: boolean; is_active: boolean;
      account_name: string | null;
    }>(
      `SELECT pm.id, pm.code, pm.name, pm.account_id, pm.requires_reference, pm.is_active,
              a.name AS account_name
         FROM payment_methods pm
         LEFT JOIN accounts a ON a.id = pm.account_id
        WHERE pm.company_id = $1
        ORDER BY pm.code`,
      [companyId]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const body = await req.json();
    const { company_id, code, name, account_id, requires_reference = false } = body;
    if (!company_id || !code || !name) return err('company_id, code, name required', 400);

    const [pm] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO payment_methods (company_id, code, name, account_id, requires_reference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name`,
      [company_id, code, name, account_id ?? null, requires_reference]
    );

    return ok(pm, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
