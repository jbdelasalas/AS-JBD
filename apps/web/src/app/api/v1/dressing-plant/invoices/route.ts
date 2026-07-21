export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module E — Invoices. GET lists; POST generates the basic-tolling invoice for a
// batch by calling the DB posting engine (dp_generate_tolling_invoice), which is
// idempotent and posts Dr 1130 AR / Cr 4100 Tolling Revenue into the real GL.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `i.company_id = $1`;
  const jobOrderId = searchParams.get('job_order_id');
  if (jobOrderId) { params.push(jobOrderId); where += ` AND i.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT i.id, i.invoice_no, i.service, i.quantity, i.rate, i.amount, i.status,
            i.job_order_id, jo.batch_no, i.client_id, c.name AS client_name,
            i.journal_entry_id, je.entry_no, i.created_at
       FROM dp_invoices i
       JOIN dp_job_orders jo ON jo.id = i.job_order_id
       JOIN dp_clients c ON c.id = i.client_id
       LEFT JOIN journal_entries je ON je.id = i.journal_entry_id
      WHERE ${where}
      ORDER BY i.created_at DESC`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const jobOrderId = dto.job_order_id as string;
  if (!jobOrderId) return err('job_order_id is required', 400);

  try {
    const [res] = await query<{ invoice_id: string }>(
      `SELECT dp_generate_tolling_invoice($1, $2) AS invoice_id`,
      [jobOrderId, auth.userId],
    );
    const [inv] = await query(
      `SELECT i.id, i.invoice_no, i.service, i.quantity, i.rate, i.amount, i.status,
              i.journal_entry_id, je.entry_no
         FROM dp_invoices i
         LEFT JOIN journal_entries je ON je.id = i.journal_entry_id
        WHERE i.id = $1`,
      [res.invoice_id],
    );
    return ok(inv, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to generate invoice', 500);
  }
}
