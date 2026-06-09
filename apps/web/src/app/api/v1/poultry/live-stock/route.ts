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
    // Show one row per tally sheet × item.
    // qty_heads / qty_kgs come from the tally sheet lines (what that tally sheet brought in).
    // avg_cost comes from poultry_inventory_balance (company-wide weighted average).
    const rows = await query(
      `SELECT
         t.id          AS tally_id,
         t.doc_no      AS tally_no,
         tsl.item_id,
         i.sku,
         i.name        AS item_name,
         i.uom,
         SUM(tsl.heads)   AS qty_heads,
         SUM(tsl.net_kgs) AS qty_kgs,
         COALESCE((
           SELECT avg_cost FROM poultry_inventory_balance
            WHERE item_id   = tsl.item_id
              AND company_id = t.company_id
            LIMIT 1
         ), 0) AS avg_cost
       FROM tally_sheets t
       JOIN tally_sheet_lines tsl ON tsl.tally_sheet_id = t.id
       JOIN items i ON i.id = tsl.item_id
       WHERE t.company_id = $1
         AND t.status     = 'posted'
       GROUP BY t.id, t.doc_no, t.transfer_date, tsl.item_id, i.sku, i.name, i.uom
       HAVING SUM(tsl.net_kgs) > 0
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
