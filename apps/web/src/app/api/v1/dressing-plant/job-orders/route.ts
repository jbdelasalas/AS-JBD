export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Job orders = the batch. Everything downstream carries this id + client_id.
// Batch numbers are auto-allocated DP-<year>-<seq> per company.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `jo.company_id = $1`;
  const status = searchParams.get('status');
  if (status) { params.push(status); where += ` AND jo.status = $${params.length}`; }

  const rows = await query(
    `SELECT jo.id, jo.batch_no, jo.status, jo.received_at, jo.locked, jo.notes,
            jo.farm_location, jo.expected_arrival, jo.expected_truck_plate, jo.expected_heads,
            jo.client_id, c.name AS client_name, c.code AS client_code, c.customer_id,
            rw.net_live_weight_kg, rw.head_count, rw.doa_count,
            yr.recovery_pct, yr.dressed_recovery_weight_kg
       FROM dp_job_orders jo
       JOIN dp_clients c ON c.id = jo.client_id
       LEFT JOIN LATERAL (
         SELECT net_live_weight_kg, head_count, doa_count
           FROM dp_receiving_weights WHERE job_order_id = jo.id
           ORDER BY created_at DESC LIMIT 1
       ) rw ON true
       LEFT JOIN LATERAL (
         SELECT recovery_pct, dressed_recovery_weight_kg
           FROM dp_yield_records WHERE job_order_id = jo.id
           ORDER BY created_at DESC LIMIT 1
       ) yr ON true
      WHERE ${where}
      ORDER BY jo.received_at DESC`,
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

  // A batch is owned by a tolling client. Callers pass an ERP customer_id (the
  // client list comes straight from the customer master); we find-or-create the
  // matching dp_clients row so the two-key model (job_orders.client_id) holds.
  let clientId = (dto.client_id as string) || null;
  const customerId = (dto.customer_id as string) || null;
  if (!clientId) {
    if (!customerId) return err('customer_id (or client_id) is required', 400);
    try {
      const cust = await query<{ code: string; name: string }>(
        `SELECT code, name FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1`,
        [customerId, companyId],
      );
      if (!cust[0]) return err('Customer not found', 404);
      const existing = await query<{ id: string }>(
        `SELECT id FROM dp_clients WHERE company_id = $1 AND customer_id = $2 LIMIT 1`,
        [companyId, customerId],
      );
      if (existing[0]) {
        clientId = existing[0].id;
      } else {
        const [created] = await query<{ id: string }>(
          `INSERT INTO dp_clients (company_id, code, name, customer_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (company_id, code) DO UPDATE SET customer_id = EXCLUDED.customer_id
           RETURNING id`,
          [companyId, cust[0].code, cust[0].name, customerId],
        );
        clientId = created.id;
      }
    } catch (e: unknown) {
      return err((e as Error).message ?? 'Failed to resolve tolling client', 500);
    }
  }

  try {
    const [seq] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM dp_job_orders WHERE company_id = $1`,
      [companyId],
    );
    const year = new Date().getFullYear();
    const batchNo = (dto.batch_no as string) || `DP-${year}-${String(seq.c + 1).padStart(5, '0')}`;

    const [row] = await query<{ id: string; batch_no: string; status: string }>(
      `INSERT INTO dp_job_orders
         (company_id, branch_id, batch_no, client_id, notes,
          farm_location, expected_arrival, expected_truck_plate, expected_heads, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, batch_no, status`,
      [
        companyId,
        (dto.branch_id as string) || null,
        batchNo,
        clientId,
        (dto.notes as string) || null,
        (dto.farm_location as string) || null,
        (dto.expected_arrival as string) || null,
        (dto.expected_truck_plate as string) || null,
        dto.expected_heads != null && dto.expected_heads !== '' ? Number(dto.expected_heads) : null,
        auth.userId,
      ],
    );
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','dp_job_order',$3)`,
      [auth.userId, companyId, row.id],
    ).catch(() => {});
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create job order';
    if (/unique|duplicate/i.test(msg)) return err('Batch number collision — please retry', 409);
    return err(msg, 500);
  }
}
