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
    // One row per tally sheet × item using the line quantities (not pib aggregate).
    // avg_cost fetched separately to avoid join-multiplication from pib.
    const rows = await query<Record<string, unknown>>(
      `SELECT
         t.id          AS tally_id,
         t.doc_no      AS tally_no,
         tsl.item_id,
         i.sku,
         i.name        AS item_name,
         i.uom,
         SUM(tsl.heads)   AS qty_heads,
         SUM(tsl.net_kgs) AS qty_kgs
       FROM tally_sheets t
       JOIN tally_sheet_lines tsl ON tsl.tally_sheet_id = t.id
       JOIN items i ON i.id = tsl.item_id
       WHERE t.company_id = $1
         AND t.status     = 'posted'
       GROUP BY t.id, t.doc_no, t.transfer_date, tsl.item_id, i.sku, i.name, i.uom
       HAVING SUM(tsl.heads) > 0 OR SUM(tsl.net_kgs) > 0
       ORDER BY t.transfer_date DESC, i.sku`,
      [companyId],
    );

    // Get avg_cost per item from pib in one query to avoid N+1 or join multiplication
    const itemIds = [...new Set(rows.map(r => r.item_id as string))];
    const avgCostMap = new Map<string, number>();
    if (itemIds.length > 0) {
      try {
        const pibRows = await query<{ item_id: string; avg_cost: number }>(
          `SELECT item_id, AVG(avg_cost) AS avg_cost
             FROM poultry_inventory_balance
            WHERE company_id = $1
            GROUP BY item_id`,
          [companyId],
        );
        for (const r of pibRows) avgCostMap.set(r.item_id, Number(r.avg_cost ?? 0));
      } catch { /* pib may be empty — skip */ }
    }

    return ok(rows.map(r => ({
      ...r,
      qty_heads: Number(r.qty_heads ?? 0),
      qty_kgs:   Number(r.qty_kgs ?? 0),
      avg_cost:  avgCostMap.get(r.item_id as string) ?? 0,
    })));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
