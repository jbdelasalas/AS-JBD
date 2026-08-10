export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

const PRODUCTS = ['diesel', 'gasoline', 'premium', 'kerosene', 'other'];
const ENTITIES = ['PPC', 'ARTPRO', 'ARTFRESH', 'JHTC'];

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query<Record<string, unknown>>(
    `SELECT s.*,
            e.full_name AS employee_name, e.employee_no, e.position AS employee_position,
            v.description AS vehicle_description, v.vehicle_type,
            b.name AS branch_name,
            a.code AS expense_account_code, a.name AS expense_account_name,
            ua.full_name AS approved_by_name,
            ur.full_name AS redeemed_by_name,
            uc.full_name AS created_by_name
       FROM fuel_po_slips s
       LEFT JOIN employees e  ON e.id  = s.employee_id
       LEFT JOIN vehicles  v  ON v.id  = s.vehicle_id
       LEFT JOIN branches  b  ON b.id  = s.branch_id
       LEFT JOIN accounts  a  ON a.id  = s.expense_account_id
       LEFT JOIN users     ua ON ua.id = s.approved_by
       LEFT JOIN users     ur ON ur.id = s.redeemed_by
       LEFT JOIN users     uc ON uc.id = s.created_by
      WHERE s.id = $1 LIMIT 1`,
    [params.id],
  );
  const slip = rows[0];
  if (!slip) return err('Slip not found', 404);

  // Same fail-closed scoping as the list route: a non-superadmin may only read
  // slips issued to their own employee record.
  if (!auth.isSuperadmin) {
    const [self] = await query<{ id: string }>(
      `SELECT id FROM employees WHERE user_id = $1 AND company_id = $2 LIMIT 1`,
      [auth.userId, slip.company_id],
    );
    if (!self || self.id !== slip.employee_id) return err('Slip not found', 404);
  }

  return ok({
    ...slip,
    quantity_litres: num(slip.quantity_litres),
    actual_litres:   num(slip.actual_litres),
    amount:          num(slip.amount),
    unit_price:      num(slip.unit_price),
    odometer_km:     num(slip.odometer_km),
    km_travelled:    num(slip.km_travelled),
    km_per_litre:    num(slip.km_per_litre),
  });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const [existing] = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM fuel_po_slips WHERE id = $1`,
    [params.id],
  );
  if (!existing) return err('Slip not found', 404);
  // Once a slip is out of draft it is a printed, approved document in someone's
  // hands — the station half is captured through /redeem, not here.
  if (existing.status !== 'draft') {
    return err(`Only draft slips can be edited (this one is ${existing.status})`, 409);
  }

  if (dto.product && !PRODUCTS.includes(dto.product as string)) {
    return err(`product must be one of: ${PRODUCTS.join(', ')}`, 400);
  }
  if (dto.entity_code && !ENTITIES.includes(dto.entity_code as string)) {
    return err(`entity_code must be one of: ${ENTITIES.join(', ')}`, 400);
  }
  const qty = num(dto.quantity_litres);
  if (qty != null && qty <= 0) return err('quantity_litres must be greater than 0', 400);

  try {
    const [slip] = await query<{ id: string }>(
      `UPDATE fuel_po_slips SET
         slip_no          = COALESCE($2, slip_no),
         entity_code      = COALESCE($3, entity_code),
         employee_id      = $4,
         issued_to_name   = COALESCE($5, issued_to_name),
         position_dept    = $6,
         vehicle_id       = $7,
         plate_no         = $8,
         product          = COALESCE($9, product),
         quantity_litres  = $10,
         issue_date       = COALESCE($11, issue_date),
         purpose          = $12,
         expense_account_id = $13,
         branch_id        = $14,
         notes            = $15
       WHERE id = $1
       RETURNING id`,
      [
        params.id,
        (dto.slip_no as string)?.trim() || null,
        (dto.entity_code as string) || null,
        (dto.employee_id as string) || null,
        (dto.issued_to_name as string)?.trim() || null,
        (dto.position_dept as string) || null,
        (dto.vehicle_id as string) || null,
        (dto.plate_no as string)?.trim()?.toUpperCase() || null,
        (dto.product as string) || null,
        qty,
        dto.issue_date ?? null,
        (dto.purpose as string) || null,
        (dto.expense_account_id as string) || null,
        (dto.branch_id as string) || null,
        (dto.notes as string) || null,
      ],
    );

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'update','fuel_po_slip',$3)`,
      [auth.userId, existing.company_id, params.id],
    ).catch(() => {});

    return ok(slip);
  } catch (e) {
    const msg = (e as Error).message ?? 'Failed to update slip';
    if (/unique|duplicate/i.test(msg)) return err(`Slip No. ${dto.slip_no} already exists`, 409);
    return err(msg, 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const [existing] = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM fuel_po_slips WHERE id = $1`,
    [params.id],
  );
  if (!existing) return err('Slip not found', 404);
  // Anything past draft stays on file — cancel it instead, so the booklet
  // number is never silently reusable.
  if (existing.status !== 'draft') {
    return err(`Only draft slips can be deleted — cancel the slip instead (this one is ${existing.status})`, 409);
  }

  await query(`DELETE FROM fuel_po_slips WHERE id = $1`, [params.id]);

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,'delete','fuel_po_slip',$3)`,
    [auth.userId, existing.company_id, params.id],
  ).catch(() => {});

  return ok({ id: params.id, deleted: true });
}
