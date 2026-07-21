export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Delivery orders bundle in_storage boxes for release. A gate pass (issued via
// /gate-passes) is what actually clears them out the gate.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT d.id, d.do_no, d.status, d.released_at, d.job_order_id, jo.batch_no,
            d.client_id, c.name AS client_name,
            (SELECT count(*)::int FROM dp_do_lines WHERE do_id = d.id) AS box_count
       FROM dp_delivery_orders d
       JOIN dp_clients c ON c.id = d.client_id
       LEFT JOIN dp_job_orders jo ON jo.id = d.job_order_id
      WHERE d.company_id = $1
      ORDER BY d.created_at DESC`,
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
  const clientId = dto.client_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!clientId) return err('client_id is required', 400);
  const boxIds = Array.isArray(dto.box_ids) ? (dto.box_ids as string[]) : [];
  if (boxIds.length === 0) return err('box_ids is required (at least one box)', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const seqRows = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM dp_delivery_orders WHERE company_id = $1`, [companyId],
    );
    const year = new Date().getFullYear();
    const doNo = `DO-${year}-${String(seqRows.rows[0].c + 1).padStart(5, '0')}`;

    const doRows = await client.query<{ id: string; do_no: string }>(
      `INSERT INTO dp_delivery_orders (company_id, do_no, job_order_id, client_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, do_no`,
      [companyId, doNo, (dto.job_order_id as string) || null, clientId, auth.userId],
    );
    const doId = doRows.rows[0].id;
    let lineNo = 0;
    for (const boxId of boxIds) {
      lineNo += 1;
      await client.query(
        `INSERT INTO dp_do_lines (do_id, line_no, box_id) VALUES ($1,$2,$3)`,
        [doId, lineNo, boxId],
      );
    }
    await client.query('COMMIT');
    return ok({ id: doId, do_no: doRows.rows[0].do_no, box_count: lineNo }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to create delivery order', 500);
  } finally {
    client.release();
  }
}
