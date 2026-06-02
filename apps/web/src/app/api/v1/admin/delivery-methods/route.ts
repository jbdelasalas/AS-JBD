export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  try {
    const rows = await query(
      `SELECT id, code, name, is_active FROM delivery_methods WHERE company_id = $1 ORDER BY sort_order, name`,
      [companyId],
    );
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const companyId = dto.company_id as string;
  if (!companyId || !dto.name) return err('company_id and name are required', 400);
  try {
    const [row] = await query(
      `INSERT INTO delivery_methods (company_id, code, name, sort_order, is_active)
       VALUES ($1, UPPER(TRIM($2::text)), UPPER(TRIM($3::text)), COALESCE($4,99), true) RETURNING *`,
      [companyId, dto.code ?? dto.name, dto.name, dto.sort_order ?? null],
    );
    return ok(row, 201);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
