export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Dispatch & Gate — issuing a gate pass is the security lock. The server (not
// client JS) re-validates that:
//   1. every invoice for the batch is cleared/paid/credit_approved, and
//   2. the scanned box count matches the boxes on the delivery order,
// before flipping the boxes in_storage → dispatched and issuing the pass. The DB
// CHECK on accounting_status is the last line of defence.

const CLEARED = ['paid', 'cleared', 'credit_approved'];

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT gp.id, gp.gate_pass_no, gp.accounting_status, gp.boxes_expected, gp.boxes_scanned,
            gp.issued_at, gp.do_id, d.do_no, c.name AS client_name
       FROM dp_gate_passes gp
       JOIN dp_delivery_orders d ON d.id = gp.do_id
       JOIN dp_clients c ON c.id = d.client_id
      WHERE gp.company_id = $1
      ORDER BY gp.issued_at DESC`,
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
  const doId = dto.do_id as string;
  const scannedCount = Number(dto.boxes_scanned ?? 0);
  if (!companyId) return err('company_id is required', 400);
  if (!doId) return err('do_id is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const doRows = await client.query<{ id: string; job_order_id: string | null; do_no: string }>(
      `SELECT id, job_order_id, do_no FROM dp_delivery_orders
        WHERE id = $1 AND company_id = $2 AND status <> 'cancelled' FOR UPDATE`,
      [doId, companyId],
    );
    const deliveryOrder = doRows.rows[0];
    if (!deliveryOrder) { await client.query('ROLLBACK'); return err('Delivery order not found', 404); }

    // 1. Accounting clearance — every invoice for the batch must be cleared.
    let acctStatus = 'cleared';
    if (deliveryOrder.job_order_id) {
      const invRows = await client.query<{ status: string }>(
        `SELECT status FROM dp_invoices WHERE job_order_id = $1`,
        [deliveryOrder.job_order_id],
      );
      const uncleared = invRows.rows.filter((r) => !CLEARED.includes(r.status));
      if (uncleared.length > 0) {
        await client.query('ROLLBACK');
        return err('Release blocked: batch has uncleared invoices. Clear accounting first.', 409);
      }
      // Reflect credit approval when any invoice is credit_approved rather than paid.
      if (invRows.rows.some((r) => r.status === 'credit_approved')) acctStatus = 'credit_approved';
      else if (invRows.rows.every((r) => r.status === 'paid')) acctStatus = 'paid';
    }

    // 2. Box scan count must match the DO lines.
    const lineRows = await client.query<{ box_id: string }>(
      `SELECT box_id FROM dp_do_lines WHERE do_id = $1`, [doId],
    );
    const expected = lineRows.rows.length;
    if (expected === 0) { await client.query('ROLLBACK'); return err('Delivery order has no boxes', 400); }
    if (scannedCount !== expected) {
      await client.query('ROLLBACK');
      return err(`Scan mismatch: ${scannedCount}/${expected} boxes scanned. All boxes must be scanned to release.`, 409);
    }

    // Flip boxes in_storage → dispatched.
    await client.query(
      `UPDATE dp_storage_boxes SET status = 'dispatched', time_out = now()
        WHERE id = ANY($1::uuid[]) AND status = 'in_storage'`,
      [lineRows.rows.map((r) => r.box_id)],
    );

    const seqRows = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM dp_gate_passes WHERE company_id = $1`, [companyId],
    );
    const year = new Date().getFullYear();
    const gpNo = `GP-${year}-${String(seqRows.rows[0].c + 1).padStart(5, '0')}`;

    const gpRows = await client.query<{ id: string; gate_pass_no: string }>(
      `INSERT INTO dp_gate_passes
         (company_id, gate_pass_no, do_id, accounting_status, boxes_expected, boxes_scanned, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, gate_pass_no`,
      [companyId, gpNo, doId, acctStatus, expected, scannedCount, auth.userId],
    );

    await client.query(
      `UPDATE dp_delivery_orders SET status = 'released', released_at = now() WHERE id = $1`,
      [doId],
    );

    await client.query('COMMIT');
    return ok(gpRows.rows[0], 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to issue gate pass', 500);
  } finally {
    client.release();
  }
}
