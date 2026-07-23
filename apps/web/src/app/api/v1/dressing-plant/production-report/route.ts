export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Production summary report — one row per recorded production entry:
//   Date · Time · Batch Number · Product Code (item sku) · Head · Weight(kg)
//
// Filters: from/to date (on the production timestamp), optional batch/product.
// Returns rows plus totals (heads, weight, packs).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `po.company_id = $1`;

  const from = searchParams.get('from');
  if (from) { params.push(from); where += ` AND po.created_at >= $${params.length}::date`; }
  const to = searchParams.get('to');
  if (to) { params.push(to); where += ` AND po.created_at < ($${params.length}::date + 1)`; } // inclusive of the "to" day
  const jobOrderId = searchParams.get('job_order_id');
  if (jobOrderId) { params.push(jobOrderId); where += ` AND po.job_order_id = $${params.length}`; }
  const itemId = searchParams.get('item_id');
  if (itemId) { params.push(itemId); where += ` AND po.item_id = $${params.length}`; }

  const rows = await query(
    `SELECT po.id,
            to_char(po.created_at, 'YYYY/MM/DD')      AS date,
            to_char(po.created_at, 'HH24:MI:SS')       AS time,
            po.created_at                              AS created_at,
            jo.batch_no                                AS batch_number,
            i.sku                                      AS product_code,
            i.name                                     AS product_name,
            s.code                                     AS size_code,
            po.head_count                              AS head,
            po.pack_count                              AS packs,
            po.weight_kg                               AS weight_kg
       FROM dp_processed_output po
       JOIN dp_job_orders jo ON jo.id = po.job_order_id
       JOIN items i ON i.id = po.item_id
       LEFT JOIN dp_sizes s ON s.id = po.size_id
      WHERE ${where}
      ORDER BY po.created_at, jo.batch_no, i.sku`,
    params,
  );

  const totals = rows.reduce<{ rows: number; head: number; packs: number; weight_kg: number }>(
    (acc, r) => {
      const rr = r as Record<string, unknown>;
      acc.head += Number(rr.head ?? 0);
      acc.packs += Number(rr.packs ?? 0);
      acc.weight_kg += Number(rr.weight_kg ?? 0);
      return acc;
    },
    { rows: rows.length, head: 0, packs: 0, weight_kg: 0 },
  );
  totals.weight_kg = Number(totals.weight_kg.toFixed(2));

  return ok({ data: rows, totals });
}
