export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  try {
    const [activeBatches] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM grow_cycles WHERE company_id=$1 AND status IN ('active','harvesting')`, [companyId]);
    const [totalBirds] = await query<{ n: number }>(
      `SELECT COALESCE(SUM(heads_available),0)::int AS n FROM grow_cycles WHERE company_id=$1 AND status IN ('active','harvesting')`, [companyId]);
    const [mortalityThisWeek] = await query<{ n: number }>(
      `SELECT COALESCE(SUM(m.heads),0)::int AS n FROM grow_mortality_logs m
         JOIN grow_cycles g ON g.id = m.grow_cycle_id
        WHERE g.company_id=$1 AND m.log_date >= CURRENT_DATE - INTERVAL '7 days'`, [companyId]);
    const [pendingDeliveries] = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM poultry_deliveries WHERE company_id=$1 AND status='saved'`, [companyId]);
    const [unpaidInvoices] = await query<{ c: number; amt: number }>(
      `SELECT count(*)::int AS c, COALESCE(SUM(balance_due),0)::numeric AS amt
         FROM poultry_invoices WHERE company_id=$1 AND payment_status='unpaid' AND status='posted'`, [companyId]);
    const recentDeliveries = await query(
      `SELECT d.doc_no, d.transaction_date, d.status, d.total_amount, c.name AS customer_name
         FROM poultry_deliveries d JOIN customers c ON c.id = d.customer_id
        WHERE d.company_id=$1 ORDER BY d.created_at DESC LIMIT 5`, [companyId]);
    const activeCycles = await query(
      `SELECT g.doc_no, g.start_date, g.heads_in, g.heads_available, g.total_mortality, g.status,
              fb.name AS building_name, i.name AS item_name
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
         JOIN items i ON i.id = b.item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
        WHERE g.company_id=$1 AND g.status IN ('active','harvesting')
        ORDER BY g.start_date ASC`, [companyId]);

    return ok({
      active_batches: activeBatches.c,
      total_birds: totalBirds.n,
      mortality_this_week: mortalityThisWeek.n,
      pending_deliveries: pendingDeliveries.c,
      unpaid_invoices_count: unpaidInvoices.c,
      unpaid_invoices_amount: Number(unpaidInvoices.amt),
      recent_deliveries: recentDeliveries,
      active_cycles: activeCycles,
    });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
