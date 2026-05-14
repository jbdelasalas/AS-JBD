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
      id: string; code: string; name: string; parent_id: string | null;
      is_active: boolean; parent_name: string | null;
    }>(
      `SELECT cc.id, cc.code, cc.name, cc.parent_id, cc.is_active, p.name AS parent_name
         FROM cost_centers cc
         LEFT JOIN cost_centers p ON p.id = cc.parent_id
        WHERE cc.company_id = $1
        ORDER BY cc.code`,
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
    const { company_id, code, name, parent_id } = body;
    if (!company_id || !code || !name) return err('company_id, code, name required', 400);

    const [cc] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO cost_centers (company_id, code, name, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name`,
      [company_id, code, name, parent_id ?? null, auth.userId]
    );

    return ok(cc, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
