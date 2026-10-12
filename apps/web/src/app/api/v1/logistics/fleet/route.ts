export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Everything the planner needs to set up a day: the trucks (from the shared
// vehicles master) and the warehouses a truck can leave from.

export async function GET(request: NextRequest) {
  try { await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  try {
    const [vehicles, warehouses] = await Promise.all([
      query(
        `SELECT v.id, v.plate_no, v.description, v.vehicle_type,
                v.capacity_kg, v.is_refrigerated, v.home_warehouse_id,
                v.default_driver, v.default_helper, v.for_delivery,
                e.full_name AS assigned_employee_name
           FROM vehicles v
           LEFT JOIN employees e ON e.id = v.assigned_employee_id
          WHERE v.company_id = $1 AND v.is_active = true
          ORDER BY v.for_delivery DESC, v.plate_no`,
        [companyId],
      ),
      query(
        `SELECT id, code, name, address, latitude, longitude
           FROM warehouses
          WHERE company_id = $1 AND is_active = true
          ORDER BY code`,
        [companyId],
      ),
    ]);
    return ok({ vehicles, warehouses });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
