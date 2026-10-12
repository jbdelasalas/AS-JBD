export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Saves a truck's delivery settings as its defaults for future plans. Only the
// delivery columns are touched; the fuel side of the vehicle record is left alone.

const FIELDS = ['capacity_kg', 'is_refrigerated', 'home_warehouse_id', 'default_driver', 'default_helper', 'for_delivery'] as const;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requirePermission>>;
  try { auth = await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of FIELDS) {
    if (!(f in dto)) continue;
    let v = dto[f];
    if (f === 'capacity_kg') v = v === '' || v == null ? null : Number(v);
    if (f === 'is_refrigerated' || f === 'for_delivery') v = v === true;
    if (f === 'home_warehouse_id' || f === 'default_driver' || f === 'default_helper') v = (v as string) || null;
    if (f === 'capacity_kg' && v != null && (!Number.isFinite(v) || (v as number) < 0)) return err('capacity_kg must be a positive number', 400);
    values.push(v);
    sets.push(`${f} = $${values.length}`);
  }
  if (!sets.length) return err('Nothing to update', 400);

  try {
    values.push(params.id, companyId);
    const rows = await query(
      `UPDATE vehicles SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${values.length - 1} AND company_id = $${values.length}
        RETURNING id, plate_no`,
      values,
    );
    if (!rows.length) return err('Vehicle not found', 404);
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'update','vehicle',$3)`,
      [auth.userId, companyId, params.id],
    ).catch(() => {});
    return ok(rows[0]);
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
