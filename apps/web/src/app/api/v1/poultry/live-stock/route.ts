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
    // One row per tally sheet × item, using the pib balance for that tally sheet's warehouse only
    const rows = await query(
      `SELECT
         t.id          AS tally_id,
         t.doc_no      AS tally_no,
         tsl.item_id,
         i.sku,
         i.name        AS item_name,
         i.uom,
         COALESCE(pib.qty_heads, 0) AS qty_heads,
         COALESCE(pib.qty_kgs,   0) AS qty_kgs,
         COALESCE(pib.avg_cost,  0) AS avg_cost
       FROM tally_sheets t
       JOIN tally_sheet_lines tsl ON tsl.tally_sheet_id = t.id
       JOIN items i ON i.id = tsl.item_id
       LEFT JOIN poultry_inventory_balance pib
         ON  pib.item_id              = tsl.item_id
         AND pib.warehouse_id IS NOT DISTINCT FROM t.warehouse_id
         AND pib.company_id           = t.company_id
       WHERE t.company_id = $1
         AND t.status     = 'posted'
         AND COALESCE(pib.qty_kgs, 0) > 0
       GROUP BY t.id, t.doc_no, tsl.item_id, i.sku, i.name, i.uom,
                pib.qty_heads, pib.qty_kgs, pib.avg_cost
       ORDER BY t.transfer_date DESC, i.sku`,
      [companyId],
    );

    return ok(rows.map(r => ({
      ...r,
      qty_heads: Number((r as Record<string, unknown>).qty_heads ?? 0),
      qty_kgs:   Number((r as Record<string, unknown>).qty_kgs ?? 0),
      avg_cost:  Number((r as Record<string, unknown>).avg_cost ?? 0),
    })));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
