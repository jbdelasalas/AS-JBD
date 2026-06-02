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

  // Load the grow cycle to get branch, building, grow_reference
  const [cycle] = await query<{
    company_id: string; branch_id: string | null;
    building_id: string | null; grow_reference: string | null;
  }>(
    `SELECT company_id, branch_id, building_id, grow_reference FROM grow_cycles WHERE id = $1`,
    [params.id],
  );
  if (!cycle) return err('Grow cycle not found', 404);

  const { company_id, branch_id, building_id, grow_reference } = cycle;

  // Resolve grow_reference text → UUID if possible
  let growRefId: string | null = null;
  if (grow_reference) {
    const [gr] = await query<{ id: string }>(
      `SELECT id FROM grow_references WHERE company_id = $1 AND name = $2 LIMIT 1`,
      [company_id, grow_reference],
    );
    growRefId = gr?.id ?? null;
  }

  // Items received via GRNs whose PO lines are tagged with this branch, building, or grow reference.
  // Also include items received into inventory_ins for this branch.
  const rows = await query(
    `SELECT DISTINCT i.id, i.sku, i.name, i.uom,
            COALESCE(sb.qty_on_hand, 0)::numeric AS qty_on_hand,
            COALESCE(sb.avg_cost, i.standard_cost, 0)::numeric AS avg_cost
       FROM items i
       LEFT JOIN stock_balances sb ON sb.item_id = i.id
      WHERE i.company_id = $1
        AND i.is_active = true
        AND COALESCE(sb.qty_on_hand, 0) > 0
        AND i.id IN (
          -- items received on PO lines tagged with this branch / building / grow ref
          SELECT DISTINCT pol.item_id
            FROM purchase_order_lines pol
            JOIN goods_receipt_lines grl ON grl.po_line_id = pol.id
            JOIN goods_receipts gr       ON gr.id = grl.grn_id
           WHERE gr.company_id = $1
             AND grl.qty_received > 0
             AND pol.item_id IS NOT NULL
             AND (
               ($2::uuid IS NOT NULL AND pol.branch_id   = $2)
               OR ($3::uuid IS NOT NULL AND pol.building_id = $3)
               OR ($4::uuid IS NOT NULL AND pol.grow_reference_id = $4)
               OR ($2::uuid IS NOT NULL AND gr.branch_id   = $2)
               OR ($3::uuid IS NOT NULL AND gr.building_id = $3)
               OR ($4::uuid IS NOT NULL AND gr.grow_reference_id = $4)
             )
          UNION
          -- items received via inventory_ins for this branch
          SELECT DISTINCT iil.item_id
            FROM inventory_in_lines iil
            JOIN inventory_ins ii ON ii.id = iil.inventory_in_id
           WHERE ii.company_id = $1
             AND ($2::uuid IS NOT NULL AND ii.branch_id = $2)
             AND iil.net_quantity > 0
        )
      ORDER BY i.sku`,
    [company_id, branch_id, building_id, growRefId],
  );

  return ok(rows.map(r => ({
    ...r,
    qty_on_hand: Number(r.qty_on_hand),
    avg_cost: Number(r.avg_cost),
  })));
}
