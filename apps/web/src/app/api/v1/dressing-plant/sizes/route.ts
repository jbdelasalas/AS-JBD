export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Managed size list for processed-chicken output (XS/S/M/L/XL/Jumbo or weight
// bands). Seeded with defaults per company; editable here.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT id, code, name, sort_order, is_active
       FROM dp_sizes WHERE company_id = $1 AND is_active = true
      ORDER BY sort_order, code`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code) return err('code is required', 400);
  if (!dto.name) return err('name is required', 400);

  try {
    const [row] = await query<{ id: string }>(
      `INSERT INTO dp_sizes (company_id, code, name, sort_order)
       VALUES ($1,$2,$3,COALESCE($4,0)) RETURNING id`,
      [companyId, String(dto.code).toUpperCase(), dto.name, dto.sort_order != null ? Number(dto.sort_order) : null],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create size';
    if (/unique|duplicate/i.test(msg)) return err(`Size ${dto.code} already exists`, 409);
    return err(msg, 500);
  }
}
