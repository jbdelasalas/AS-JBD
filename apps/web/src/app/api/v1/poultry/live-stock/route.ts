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
    // One row per (tally_sheet × item). qty = tally sheet's own received kgs.
    // avg_cost from pib (company-wide average).
    const rows = await query<Record<string, unknown>>(
      `SELECT
         t.id             AS tally_id,
         t.doc_no         AS tally_no,
         t.transfer_date,
         tsl.item_id,
         i.sku,
         i.name           AS item_name,
         i.uom,
         SUM(tsl.heads)   AS qty_heads,
         SUM(tsl.net_kgs) AS qty_kgs,
         COALESCE(AVG(pib.avg_cost), 0) AS avg_cost
       FROM tally_sheets t
       JOIN tally_sheet_lines tsl ON tsl.tally_sheet_id = t.id
       JOIN items i ON i.id = tsl.item_id
       LEFT JOIN (
         SELECT item_id, company_id, AVG(avg_cost) AS avg_cost
           FROM poultry_inventory_balance
          WHERE company_id = $1
          GROUP BY item_id, company_id
       ) pib ON pib.item_id = tsl.item_id
       WHERE t.company_id = $1
         AND t.status     = 'posted'
       GROUP BY t.id, t.doc_no, t.transfer_date, tsl.item_id, i.sku, i.name, i.uom, pib.avg_cost
       HAVING SUM(tsl.heads) > 0 OR SUM(tsl.net_kgs) > 0
       ORDER BY t.transfer_date DESC, i.sku`,
      [companyId],
    );

    return ok(rows.map(r => ({
      tally_id:  r.tally_id,
      tally_no:  r.tally_no,
      item_id:   r.item_id,
      qty_heads: Number(r.qty_heads ?? 0),
      qty_kgs:   Number(r.qty_kgs   ?? 0),
      avg_cost:  Number(r.avg_cost  ?? 0),
      sku:       r.sku,
      item_name: r.item_name,
      uom:       r.uom,
    })));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
