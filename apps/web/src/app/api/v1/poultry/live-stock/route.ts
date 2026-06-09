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
    const rows = await query(
      `SELECT
         pib.item_id,
         SUM(pib.qty_heads) AS qty_heads,
         SUM(pib.qty_kgs)   AS qty_kgs,
         AVG(pib.avg_cost)  AS avg_cost,
         i.sku, i.name AS item_name, i.uom,
         latest.doc_no  AS tally_no,
         latest.id      AS tally_id
       FROM poultry_inventory_balance pib
       JOIN items i ON i.id = pib.item_id
       LEFT JOIN LATERAL (
         SELECT t.id, t.doc_no
           FROM tally_sheet_lines tsl
           JOIN tally_sheets t ON t.id = tsl.tally_sheet_id
          WHERE tsl.item_id = pib.item_id
            AND t.company_id = $1
            AND t.status = 'posted'
          ORDER BY t.transfer_date DESC, t.created_at DESC
          LIMIT 1
       ) latest ON true
       WHERE pib.company_id = $1 AND pib.qty_kgs > 0
       GROUP BY pib.item_id, i.sku, i.name, i.uom, latest.doc_no, latest.id
       HAVING SUM(pib.qty_kgs) > 0
       ORDER BY i.sku`,
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
