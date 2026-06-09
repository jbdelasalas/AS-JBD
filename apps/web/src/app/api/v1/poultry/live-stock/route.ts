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
    // Step 1: distinct live items from pib (deduplicate NULL warehouse rows)
    const balRows = await query<Record<string, unknown>>(
      `SELECT DISTINCT ON (item_id) item_id, qty_heads, qty_kgs, avg_cost
         FROM poultry_inventory_balance
        WHERE company_id = $1 AND (qty_heads > 0 OR qty_kgs > 0)
        ORDER BY item_id, qty_kgs DESC`,
      [companyId],
    );
    if (!balRows.length) return ok([]);

    const itemIds = balRows.map(r => r.item_id as string);

    // Step 2: item details
    const itemRows = await query<Record<string, unknown>>(
      `SELECT id, sku, name AS item_name, uom FROM items WHERE id = ANY($1)`,
      [itemIds],
    );
    const itemMap = new Map(itemRows.map(r => [r.id as string, r]));

    // Step 3: per (tally_sheet × item) totals — GROUP BY to avoid window-function inflation
    const tsRows = await query<Record<string, unknown>>(
      `SELECT tsl.item_id,
              t.id           AS tally_id,
              t.doc_no       AS tally_no,
              t.transfer_date,
              SUM(tsl.net_kgs) AS ts_kgs,
              SUM(tsl.heads)   AS ts_heads
         FROM tally_sheet_lines tsl
         JOIN tally_sheets t ON t.id = tsl.tally_sheet_id
        WHERE t.company_id = $1
          AND t.status     = 'posted'
          AND tsl.item_id  = ANY($2)
        GROUP BY tsl.item_id, t.id, t.doc_no, t.transfer_date
        ORDER BY tsl.item_id, t.transfer_date DESC`,
      [companyId, itemIds],
    );

    // Pick latest tally sheet per item in JS
    const latestTs = new Map<string, Record<string, unknown>>();
    for (const row of tsRows) {
      const id = row.item_id as string;
      if (!latestTs.has(id)) latestTs.set(id, row); // already ordered DESC, first = latest
    }

    return ok(balRows.map(r => {
      const item = itemMap.get(r.item_id as string);
      const ts   = latestTs.get(r.item_id as string);
      return {
        item_id:   r.item_id,
        qty_heads: Number(ts?.ts_heads ?? r.qty_heads ?? 0),
        qty_kgs:   Number(ts?.ts_kgs   ?? r.qty_kgs   ?? 0),
        avg_cost:  Number(r.avg_cost   ?? 0),
        sku:       item?.sku      ?? '',
        item_name: item?.item_name ?? '',
        uom:       item?.uom      ?? '',
        tally_no:  ts?.tally_no   ?? null,
        tally_id:  ts?.tally_id   ?? null,
      };
    }).filter(r => r.sku));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
