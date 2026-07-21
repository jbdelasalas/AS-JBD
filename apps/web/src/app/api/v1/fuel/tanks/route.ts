export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Storage tanks for the fuel module. Each tank holds one fuel product (item) and
// lives inside a warehouse. List is scoped to a company; create is straightforward.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT t.id, t.tank_no, t.tank_name, t.capacity_litres, t.safe_fill_litres,
            t.dead_stock_litres, t.is_active,
            t.warehouse_id, w.name AS warehouse_name,
            t.item_id, i.name AS item_name, i.code AS item_code,
            (SELECT r.observed_litres
               FROM tank_readings r
              WHERE r.tank_id = t.id
              ORDER BY r.reading_at DESC
              LIMIT 1) AS last_observed_litres,
            (SELECT r.reading_at
               FROM tank_readings r
              WHERE r.tank_id = t.id
              ORDER BY r.reading_at DESC
              LIMIT 1) AS last_reading_at
       FROM fuel_tanks t
       JOIN warehouses w ON w.id = t.warehouse_id
       JOIN items i      ON i.id = t.item_id
      WHERE t.company_id = $1
      ORDER BY t.tank_no`,
    [companyId],
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
  if (!dto.tank_no)      return err('tank_no is required', 400);
  if (!dto.warehouse_id) return err('warehouse_id is required', 400);
  if (!dto.item_id)      return err('item_id (fuel product) is required', 400);
  const capacity = Number(dto.capacity_litres);
  if (!(capacity > 0)) return err('capacity_litres must be greater than 0', 400);

  try {
    const [tank] = await query<{ id: string; tank_no: string }>(
      `INSERT INTO fuel_tanks
         (company_id, warehouse_id, tank_no, tank_name, item_id,
          capacity_litres, safe_fill_litres, dead_stock_litres, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, true))
       RETURNING id, tank_no`,
      [
        companyId,
        dto.warehouse_id,
        String(dto.tank_no).toUpperCase(),
        (dto.tank_name as string) || null,
        dto.item_id,
        capacity,
        dto.safe_fill_litres != null ? Number(dto.safe_fill_litres) : null,
        dto.dead_stock_litres != null ? Number(dto.dead_stock_litres) : 0,
        dto.is_active as boolean | undefined ?? null,
      ],
    );

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','fuel_tank',$3)`,
      [auth.userId, companyId, tank.id],
    ).catch(() => {});

    return ok(tank, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create tank';
    if (/unique|duplicate/i.test(msg)) return err(`Tank ${dto.tank_no} already exists`, 409);
    return err(msg, 500);
  }
}
