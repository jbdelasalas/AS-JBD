export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module D — Cold Chain. Storage boxes carry a box_uuid (barcode on the CCPT
// label). The hourly storage clock (dp_run_storage_clock) accrues daily rental;
// boxes flip in_storage → dispatched only via the gate-pass flow.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `b.company_id = $1`;
  const status = searchParams.get('status');
  if (status) { params.push(status); where += ` AND b.status = $${params.length}`; }
  const jobOrderId = searchParams.get('job_order_id');
  if (jobOrderId) { params.push(jobOrderId); where += ` AND b.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT b.id, b.box_uuid, b.product, b.net_weight_kg, b.pallet, b.room,
            b.time_in, b.time_out, b.status,
            b.job_order_id, jo.batch_no,
            COALESCE((SELECT SUM(amount) FROM dp_storage_accruals WHERE box_id = b.id), 0) AS accrued_amount
       FROM dp_storage_boxes b
       JOIN dp_job_orders jo ON jo.id = b.job_order_id
      WHERE ${where}
      ORDER BY b.time_in DESC`,
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
  const jobOrderId = dto.job_order_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!jobOrderId) return err('job_order_id is required', 400);
  if (!dto.product) return err('product is required', 400);
  const weight = Number(dto.net_weight_kg);
  if (!(weight > 0)) return err('net_weight_kg must be greater than 0', 400);

  try {
    const [row] = await query<{ id: string; box_uuid: string }>(
      `INSERT INTO dp_storage_boxes
         (company_id, job_order_id, product, net_weight_kg, pallet, room)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, box_uuid`,
      [
        companyId, jobOrderId, dto.product, weight,
        (dto.pallet as string) || null, (dto.room as string) || null,
      ],
    );
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','dp_storage_box',$3)`,
      [auth.userId, companyId, row.id],
    ).catch(() => {});
    return ok(row, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to store box', 500);
  }
}
