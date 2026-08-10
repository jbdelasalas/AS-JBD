export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

const PRODUCTS = ['diesel', 'gasoline', 'premium', 'kerosene', 'other'];
const ENTITIES = ['PPC', 'ARTPRO', 'ARTFRESH', 'JHTC'];

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    quantity_litres: num(r.quantity_litres),
    actual_litres:   num(r.actual_litres),
    amount:          num(r.amount),
    unit_price:      num(r.unit_price),
    odometer_km:     num(r.odometer_km),
    km_travelled:    num(r.km_travelled),
    km_per_litre:    num(r.km_per_litre),
  };
}

const LIST_SELECT = `
  SELECT s.id, s.slip_no, s.entity_code, s.issue_date, s.issued_to_name,
         s.position_dept, s.plate_no, s.product, s.quantity_litres,
         s.station_name, s.gas_up_at, s.odometer_km, s.actual_litres,
         s.official_receipt_no, s.amount, s.unit_price,
         s.km_travelled, s.km_per_litre, s.status,
         s.employee_id, e.full_name AS employee_name, e.employee_no,
         s.vehicle_id, v.description AS vehicle_description,
         s.approved_by, ua.full_name AS approved_by_name, s.approved_at
    FROM fuel_po_slips s
    LEFT JOIN employees e ON e.id = s.employee_id
    LEFT JOIN vehicles  v ON v.id = s.vehicle_id
    LEFT JOIN users    ua ON ua.id = s.approved_by`;

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  const params: unknown[] = [companyId];
  let where = 's.company_id = $1';

  const status = searchParams.get('status');
  const employeeId = searchParams.get('employee_id');
  const vehicleId = searchParams.get('vehicle_id');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const search = searchParams.get('search');

  if (status)     { params.push(status);     where += ` AND s.status = $${params.length}`; }
  if (employeeId) { params.push(employeeId); where += ` AND s.employee_id = $${params.length}`; }
  if (vehicleId)  { params.push(vehicleId);  where += ` AND s.vehicle_id = $${params.length}`; }
  if (dateFrom)   { params.push(dateFrom);   where += ` AND s.issue_date >= $${params.length}`; }
  if (dateTo)     { params.push(dateTo);     where += ` AND s.issue_date <= $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (s.slip_no ILIKE $${params.length} OR s.issued_to_name ILIKE $${params.length}`
           + ` OR s.plate_no ILIKE $${params.length} OR s.official_receipt_no ILIKE $${params.length})`;
  }

  // Non-superadmins only see slips issued to themselves. Resolve the caller's
  // employee row from the session — never from a query param, which the client
  // controls. A user with no linked employee record sees nothing (fail closed).
  if (!auth.isSuperadmin) {
    const [self] = await query<{ id: string }>(
      `SELECT id FROM employees WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
      [auth.userId, companyId],
    );
    if (!self) return ok({ data: [], total: 0, page: 1, page_size: limit, summary: null });
    params.push(self.id);
    where += ` AND s.employee_id = $${params.length}`;
  }

  try {
    const filterParams = [...params];
    params.push(limit, offset);

    const rows = await query(
      `${LIST_SELECT} WHERE ${where}
        ORDER BY s.issue_date DESC, s.slip_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const [counts] = await query<{ c: number; litres: string | null; amount: string | null }>(
      `SELECT count(*)::int AS c,
              sum(s.actual_litres) AS litres,
              sum(s.amount) AS amount
         FROM fuel_po_slips s WHERE ${where}`,
      filterParams,
    );

    return ok({
      data: rows.map((r) => mapRow(r as Record<string, unknown>)),
      total: counts.c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
      summary: {
        total_litres: num(counts.litres) ?? 0,
        total_amount: num(counts.amount) ?? 0,
      },
    });
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

  const issuedToName = (dto.issued_to_name as string)?.trim();
  if (!issuedToName) return err('issued_to_name is required', 400);

  const product = (dto.product as string) || 'diesel';
  if (!PRODUCTS.includes(product)) return err(`product must be one of: ${PRODUCTS.join(', ')}`, 400);

  const entity = (dto.entity_code as string) || 'ARTFRESH';
  if (!ENTITIES.includes(entity)) return err(`entity_code must be one of: ${ENTITIES.join(', ')}`, 400);

  const qty = num(dto.quantity_litres);
  if (qty != null && qty <= 0) return err('quantity_litres must be greater than 0', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Booklets are pre-printed, so the slip number normally comes from the pad.
    // Fall back to the document series when the caller does not supply one.
    let slipNo = (dto.slip_no as string)?.trim();
    if (!slipNo) {
      const series = await client.query(
        `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
          WHERE company_id = $1 AND doc_type = 'fuel_po_slip' AND is_active = true
          RETURNING prefix, current_number`,
        [companyId],
      );
      if (!series.rows[0]) {
        await client.query('ROLLBACK');
        return err('No slip_no given and no active document series for fuel_po_slip', 400);
      }
      slipNo = `${series.rows[0].prefix}${String(Number(series.rows[0].current_number)).padStart(6, '0')}`;
    }

    // Snapshot the plate on the slip: an explicit plate wins (rented units),
    // otherwise inherit from the selected vehicle.
    let plateNo = (dto.plate_no as string)?.trim()?.toUpperCase() || null;
    if (!plateNo && dto.vehicle_id) {
      const v = await client.query(`SELECT plate_no FROM vehicles WHERE id = $1`, [dto.vehicle_id]);
      plateNo = v.rows[0]?.plate_no ?? null;
    }

    const res = await client.query(
      `INSERT INTO fuel_po_slips
         (company_id, branch_id, slip_no, entity_code, employee_id, issued_to_name,
          position_dept, vehicle_id, plate_no, product, quantity_litres, issue_date,
          purpose, expense_account_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16)
       RETURNING id, slip_no`,
      [
        companyId,
        (dto.branch_id as string) || null,
        slipNo,
        entity,
        (dto.employee_id as string) || null,
        issuedToName,
        (dto.position_dept as string) || null,
        (dto.vehicle_id as string) || null,
        plateNo,
        product,
        qty,
        dto.issue_date ?? new Date().toISOString().slice(0, 10),
        (dto.purpose as string) || null,
        (dto.expense_account_id as string) || null,
        (dto.notes as string) || null,
        auth.userId,
      ],
    );
    const slip = res.rows[0];

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','fuel_po_slip',$3)`,
      [auth.userId, companyId, slip.id],
    ).catch(() => {});

    await client.query('COMMIT');
    return ok(slip, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    const msg = (e as Error).message ?? 'Failed to create slip';
    if (/unique|duplicate/i.test(msg)) return err(`Slip No. ${dto.slip_no} already exists`, 409);
    return err(msg, 500);
  } finally {
    client.release();
  }
}
