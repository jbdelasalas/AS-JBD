export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Machinery assets and their PM thresholds. hours_to_service = remaining runtime
// before the next service is due; a negative value means overdue.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT id, code, name, current_runtime_hours, next_service_threshold_hours, is_active,
            (next_service_threshold_hours - current_runtime_hours) AS hours_to_service
       FROM dp_assets_machinery
      WHERE company_id = $1
      ORDER BY name`,
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
      `INSERT INTO dp_assets_machinery
         (company_id, code, name, current_runtime_hours, next_service_threshold_hours)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        companyId, String(dto.code).toUpperCase(), dto.name,
        dto.current_runtime_hours != null ? Number(dto.current_runtime_hours) : 0,
        dto.next_service_threshold_hours != null ? Number(dto.next_service_threshold_hours) : null,
      ],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create asset';
    if (/unique|duplicate/i.test(msg)) return err(`Asset ${dto.code} already exists`, 409);
    return err(msg, 500);
  }
}
