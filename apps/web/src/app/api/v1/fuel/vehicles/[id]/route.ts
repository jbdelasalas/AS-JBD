export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT v.*, e.full_name AS assigned_employee_name,
            d.name AS department_name, cc.name AS cost_center_name,
            a.code AS expense_account_code, a.name AS expense_account_name
       FROM vehicles v
       LEFT JOIN employees    e  ON e.id  = v.assigned_employee_id
       LEFT JOIN departments  d  ON d.id  = v.department_id
       LEFT JOIN cost_centers cc ON cc.id = v.cost_center_id
       LEFT JOIN accounts     a  ON a.id  = v.expense_account_id
      WHERE v.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!rows[0]) return err('Vehicle not found', 404);
  return ok(rows[0]);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  try {
    const [v] = await query<{ id: string; company_id: string }>(
      `UPDATE vehicles SET
         plate_no        = COALESCE($2, plate_no),
         description     = $3,
         vehicle_type    = $4,
         default_product = $5,
         tank_capacity_l = $6,
         assigned_employee_id = $7,
         department_id   = $8,
         cost_center_id  = $9,
         expense_account_id = $10,
         is_active       = COALESCE($11, is_active),
         notes           = $12
       WHERE id = $1
       RETURNING id, company_id`,
      [
        params.id,
        dto.plate_no ? String(dto.plate_no).toUpperCase().trim() : null,
        (dto.description as string) || null,
        (dto.vehicle_type as string) || null,
        (dto.default_product as string) || null,
        dto.tank_capacity_l != null && dto.tank_capacity_l !== '' ? Number(dto.tank_capacity_l) : null,
        (dto.assigned_employee_id as string) || null,
        (dto.department_id as string) || null,
        (dto.cost_center_id as string) || null,
        (dto.expense_account_id as string) || null,
        dto.is_active as boolean | undefined ?? null,
        (dto.notes as string) || null,
      ],
    );
    if (!v) return err('Vehicle not found', 404);

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'update','vehicle',$3)`,
      [auth.userId, v.company_id, v.id],
    ).catch(() => {});

    return ok(v);
  } catch (e) {
    const msg = (e as Error).message ?? 'Failed to update vehicle';
    if (/unique|duplicate/i.test(msg)) return err(`Plate ${dto.plate_no} already exists`, 409);
    return err(msg, 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  // Vehicles referenced by slips are deactivated rather than deleted so the
  // history on those slips keeps resolving.
  const [used] = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM fuel_po_slips WHERE vehicle_id = $1`,
    [params.id],
  );

  if (used.c > 0) {
    const [v] = await query<{ id: string; company_id: string }>(
      `UPDATE vehicles SET is_active = false WHERE id = $1 RETURNING id, company_id`,
      [params.id],
    );
    if (!v) return err('Vehicle not found', 404);
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'deactivate','vehicle',$3)`,
      [auth.userId, v.company_id, v.id],
    ).catch(() => {});
    return ok({ id: v.id, deactivated: true, reason: `Vehicle has ${used.c} slip(s); deactivated instead of deleted` });
  }

  const [v] = await query<{ id: string; company_id: string }>(
    `DELETE FROM vehicles WHERE id = $1 RETURNING id, company_id`,
    [params.id],
  );
  if (!v) return err('Vehicle not found', 404);

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,'delete','vehicle',$3)`,
    [auth.userId, v.company_id, v.id],
  ).catch(() => {});

  return ok({ id: v.id, deleted: true });
}
