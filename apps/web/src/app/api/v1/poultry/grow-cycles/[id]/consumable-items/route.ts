export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  // Load the grow cycle to get branch, building, grow_reference, and the chick
  // item being grown (so it can be excluded from the consumable list — you don't
  // "consume" the day-old chicks you are raising).
  const [cycle] = await query<{
    company_id: string; branch_id: string | null;
    building_id: string | null; grow_reference: string | null;
    chick_item_id: string | null;
  }>(
    `SELECT g.company_id, g.branch_id, g.building_id, g.grow_reference,
            b.item_id AS chick_item_id
       FROM grow_cycles g
       LEFT JOIN chick_batches b ON b.id = g.batch_id
      WHERE g.id = $1`,
    [params.id],
  );
  if (!cycle) return err('Grow cycle not found', 404);

  const { company_id, branch_id, building_id, grow_reference, chick_item_id } = cycle;

  // Resolve grow_reference text → UUID if possible
  let growRefId: string | null = null;
  if (grow_reference) {
    const [gr] = await query<{ id: string }>(
      `SELECT id FROM grow_references WHERE company_id = $1 AND name = $2 LIMIT 1`,
      [company_id, grow_reference],
    );
    growRefId = gr?.id ?? null;
  }

  // Items received via GRNs whose PO lines are tagged with this branch AND building AND grow reference.
  // Also include items received into inventory_ins for this branch.
  // stock_balances is aggregated per item to avoid duplicate rows from multiple warehouses.
  const rows = await query(
    `SELECT i.id, i.sku, i.name, i.uom,
            COALESCE(sb.qty_on_hand, 0)::numeric AS qty_on_hand,
            COALESCE(sb.avg_cost, i.standard_cost, 0)::numeric AS avg_cost
       FROM items i
       LEFT JOIN (
         SELECT item_id,
                SUM(qty_on_hand) AS qty_on_hand,
                CASE WHEN SUM(qty_on_hand) > 0
                     THEN SUM(qty_on_hand * avg_cost) / SUM(qty_on_hand)
                     ELSE MAX(avg_cost) END AS avg_cost
           FROM stock_balances
          GROUP BY item_id
       ) sb ON sb.item_id = i.id
      WHERE i.company_id = $1
        AND i.is_active = true
        AND COALESCE(sb.qty_on_hand, 0) > 0
        AND ($5::uuid IS NULL OR i.id <> $5)   -- exclude the chick item being grown
        AND i.id IN (
          -- items received on GRN/PO lines matching ALL set tags (AND logic)
          SELECT DISTINCT pol.item_id
            FROM purchase_order_lines pol
            JOIN goods_receipt_lines grl ON grl.po_line_id = pol.id
            JOIN goods_receipts gr       ON gr.id = grl.grn_id
           WHERE gr.company_id = $1
             AND grl.qty_received > 0
             AND pol.item_id IS NOT NULL
             AND ($2::uuid IS NULL OR pol.branch_id        = $2 OR gr.branch_id        = $2)
             AND ($3::uuid IS NULL OR pol.building_id      = $3 OR gr.building_id      = $3)
             AND ($4::uuid IS NULL OR pol.grow_reference_id = $4 OR gr.grow_reference_id = $4)
          UNION
          -- items received via inventory_ins for this branch (table has no building/grow tag)
          SELECT DISTINCT iil.item_id
            FROM inventory_in_lines iil
            JOIN inventory_ins ii ON ii.id = iil.inventory_in_id
           WHERE ii.company_id = $1
             AND ($2::uuid IS NULL OR ii.branch_id = $2)
             AND iil.net_quantity > 0
        )
      ORDER BY i.sku`,
    [company_id, branch_id, building_id, growRefId, chick_item_id],
  );

  return ok(rows.map(r => ({
    ...r,
    qty_on_hand: Number(r.qty_on_hand),
    avg_cost: Number(r.avg_cost),
  })));
}
