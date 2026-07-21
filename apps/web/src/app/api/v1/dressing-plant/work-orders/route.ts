export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Engineering / maintenance queue. Work orders track preventive & corrective
// maintenance against plant machinery. Completion posting (Dr 5340 R&M / Cr 1150
// spares + 2130 accrued wages) is handled by the [id]/complete action.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `w.company_id = $1`;
  const status = searchParams.get('status');
  if (status) { params.push(status); where += ` AND w.status = $${params.length}`; }

  const rows = await query(
    `SELECT w.id, w.wo_no, w.wo_type, w.status, w.description,
            w.parts_cost, w.labor_hours, w.labor_cost, w.completed_at,
            w.asset_id, a.name AS asset_name, a.code AS asset_code
       FROM dp_work_orders w
       LEFT JOIN dp_assets_machinery a ON a.id = w.asset_id
      WHERE ${where}
      ORDER BY w.created_at DESC`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.description) return err('description is required', 400);
  const woType = (dto.wo_type as string) || 'corrective';
  if (!['preventive', 'corrective'].includes(woType)) return err('wo_type must be preventive or corrective', 400);

  try {
    const [seq] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM dp_work_orders WHERE company_id = $1`, [companyId],
    );
    const year = new Date().getFullYear();
    const woNo = `WO-${year}-${String(seq.c + 1).padStart(5, '0')}`;

    const [row] = await query<{ id: string; wo_no: string }>(
      `INSERT INTO dp_work_orders
         (company_id, wo_no, asset_id, wo_type, description, parts_cost, labor_hours, labor_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, wo_no`,
      [
        companyId, woNo, (dto.asset_id as string) || null, woType, dto.description,
        dto.parts_cost != null ? Number(dto.parts_cost) : 0,
        dto.labor_hours != null ? Number(dto.labor_hours) : 0,
        dto.labor_cost != null ? Number(dto.labor_cost) : 0,
        auth.userId,
      ],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to create work order', 500);
  }
}
