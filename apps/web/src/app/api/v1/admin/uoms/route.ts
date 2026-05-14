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
      id: string; code: string; name: string; type: string; is_base: boolean;
    }>(
      `SELECT id, code, name, type, is_base FROM uoms WHERE company_id = $1 ORDER BY type, code`,
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
    const { company_id, code, name, type, is_base = false } = body;
    if (!company_id || !code || !name || !type) {
      return err('company_id, code, name, type required', 400);
    }

    const [uom] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO uoms (company_id, code, name, type, is_base)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name`,
      [company_id, code, name, type, is_base]
    );

    return ok(uom, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
