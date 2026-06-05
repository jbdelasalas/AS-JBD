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
      bir_atp_number: string | null;
      ptu_number: string | null; is_active: boolean; created_at: string;
    }>(
      `SELECT id, code, name, address, bir_atp_number, ptu_number, is_active, created_at
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
    const { company_id, code, name, address } = body;
    if (!company_id || !code || !name) return err('company_id, code, name required', 400);

    const [branch] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO branches (company_id, code, name, address, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name`,
      [company_id, code, name, address ?? null, auth.userId]
    );

    // Auto-create a matching warehouse so Inventory Locations stays in sync
    await query(
      `INSERT INTO warehouses (company_id, branch_id, code, name, address, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, branch_id = EXCLUDED.branch_id`,
      [company_id, branch.id, code, name, address ?? null]
    ).catch(() => {}); // non-fatal if warehouse already exists

    return ok(branch, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
