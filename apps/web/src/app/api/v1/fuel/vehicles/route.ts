export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Company vehicles that fuel P.O. slips are issued against. A slip can also name
// a plate that has no vehicle record (rented units), so this is a convenience
// master list rather than a hard requirement.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const activeOnly = searchParams.get('active') === 'true';

  try {
    const rows = await query(
      `SELECT v.id, v.plate_no, v.description, v.vehicle_type, v.default_product,
              v.tank_capacity_l, v.is_active, v.notes,
              v.assigned_employee_id, e.full_name AS assigned_employee_name,
              v.department_id, d.name AS department_name,
              v.cost_center_id, cc.name AS cost_center_name,
              v.expense_account_id, a.code AS expense_account_code, a.name AS expense_account_name,
              (SELECT s.odometer_km FROM fuel_po_slips s
                WHERE s.vehicle_id = v.id AND s.status = 'redeemed' AND s.odometer_km IS NOT NULL
                ORDER BY s.odometer_km DESC LIMIT 1) AS last_odometer_km
         FROM vehicles v
         LEFT JOIN employees    e  ON e.id  = v.assigned_employee_id
         LEFT JOIN departments  d  ON d.id  = v.department_id
         LEFT JOIN cost_centers cc ON cc.id = v.cost_center_id
         LEFT JOIN accounts     a  ON a.id  = v.expense_account_id
        WHERE v.company_id = $1
          AND ($2 = false OR v.is_active = true)
        ORDER BY v.plate_no`,
      [companyId, activeOnly],
    );
    return ok({ data: rows });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.plate_no) return err('plate_no is required', 400);

  try {
    const [v] = await query<{ id: string; plate_no: string }>(
      `INSERT INTO vehicles
         (company_id, plate_no, description, vehicle_type, default_product,
          tank_capacity_l, assigned_employee_id, department_id, cost_center_id,
          expense_account_id, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,true),$12)
       RETURNING id, plate_no`,
      [
        companyId,
        String(dto.plate_no).toUpperCase().trim(),
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

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','vehicle',$3)`,
      [auth.userId, companyId, v.id],
    ).catch(() => {});

    return ok(v, 201);
  } catch (e) {
    const msg = (e as Error).message ?? 'Failed to create vehicle';
    if (/unique|duplicate/i.test(msg)) return err(`Vehicle ${dto.plate_no} already exists`, 409);
    return err(msg, 500);
  }
}
