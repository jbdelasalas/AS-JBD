export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  try {
    const rows = await query(`SELECT * FROM departments WHERE company_id = $1 ORDER BY code`, [companyId]);
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.code || !dto.name) return err('company_id, code, and name are required', 400);
  try {
    const [row] = await query(
      `INSERT INTO departments (company_id, code, name, description, is_active)
       VALUES ($1,$2,$3,$4,true) RETURNING *`,
      [companyId, dto.code, dto.name, dto.description ?? null],
    );
    return ok(row, 201);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
