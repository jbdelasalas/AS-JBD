export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');
    if (!companyId) return err('company_id required', 400);

    const rows = await query<{
      id: string; code: string; name: string; address: string | null;
      phone: string | null; bir_atp_number: string | null;
      ptu_number: string | null; is_active: boolean; created_at: string;
    }>(
      `SELECT id, code, name, address, phone, bir_atp_number, ptu_number, is_active, created_at
         FROM branches
        WHERE company_id = $1
        ORDER BY code`,
      [companyId]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const body = await req.json();
    const { company_id, code, name, address, phone } = body;
    if (!company_id || !code || !name) return err('company_id, code, name required', 400);

    const [branch] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO branches (company_id, code, name, address, phone, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, name`,
      [company_id, code, name, address ?? null, phone ?? null, auth.userId]
    );

    return ok(branch, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
