export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  const [rec] = await query<Record<string, unknown>>(
    `SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);
  const lines = await query<Record<string, unknown>>(`SELECT * FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);
  if (!lines.length) return err('No lines to post', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Update grow cycle harvested heads if linked
    let liveItemId: string | null = null;
    let liveAvgCostPerKg = 0;
    if (rec.grow_cycle_id) {
      const harvestedHeads = Number(rec.net_heads ?? 0);
      await client.query(
        `UPDATE grow_cycles SET heads_harvested = heads_harvested + $1, heads_available = heads_available - $1,
          status = CASE WHEN heads_available - $1 <= 0 THEN 'completed' ELSE 'harvesting' END
         WHERE id = $2`,
        [harvestedHeads, rec.grow_cycle_id],
      );

      // Compute live chicken avg cost: (DOC cost + consumption) ÷ total harvested kgs
      const [gc] = await client.query(
        `SELECT g.chick_price_per_head, g.heads_in, g.live_item_id,
                COALESCE(SUM(c.total_cost), 0) AS total_consumption_cost
           FROM grow_cycles g
           LEFT JOIN grow_item_consumption c ON c.grow_cycle_id = g.id
          WHERE g.id = $1
          GROUP BY g.id, g.chick_price_per_head, g.heads_in, g.live_item_id`,
        [rec.grow_cycle_id],
      ).then(r => r.rows);

      if (gc?.live_item_id) {
        liveItemId = gc.live_item_id as string;
        const totalDocCost = Number(gc.chick_price_per_head) * Number(gc.heads_in);
        const totalConsumptionCost = Number(gc.total_consumption_cost);
        const totalGrowCost = totalDocCost + totalConsumptionCost;

        // Sum kgs already posted from previous tally sheets for this grow cycle
        const prevKgsResult = await client.query(
          `SELECT COALESCE(SUM(tsl.net_kgs), 0) AS prev_kgs
             FROM tally_sheet_lines tsl
             JOIN tally_sheets ts ON ts.id = tsl.tally_sheet_id
            WHERE ts.grow_cycle_id = $1 AND ts.status = 'posted' AND tsl.item_id = $2`,
          [rec.grow_cycle_id, liveItemId],
        );
        const prevKgs = Number(prevKgsResult.rows[0]?.prev_kgs ?? 0);
        const currentKgs = lines
          .filter(l => l.item_id === liveItemId)
          .reduce((s, l) => s + Number(l.net_kgs ?? 0), 0);
        const totalHarvestedKgs = prevKgs + currentKgs;

        if (totalHarvestedKgs > 0) {
          liveAvgCostPerKg = totalGrowCost / totalHarvestedKgs;
        }
      }
    }

    // Write inventory for each line
    for (const l of lines) {
      const netKgs = Number(l.net_kgs ?? 0);
      const heads = Number(l.heads ?? 0);
      if (netKgs <= 0 && heads <= 0) continue;

      const balRow = await client.query(
        `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
          WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
        [rec.company_id, rec.warehouse_id, l.item_id],
      );
      const bal = balRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
      const newHeads = Number(bal.qty_heads) + heads;
      const newKgs = Number(bal.qty_kgs) + netKgs;

      await client.query(
        `INSERT INTO poultry_inventory_ledger (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_in, kgs_in, balance_heads, balance_kgs)
         SELECT $1,$2,$3,'in','tally_sheet',$4,doc_no,$5,$6,$7,$8,$9 FROM tally_sheets WHERE id=$4`,
        [rec.company_id, rec.warehouse_id, l.item_id, params.id, rec.transfer_date, heads, netKgs, newHeads, newKgs],
      );
      // For the live chicken item, carry the computed avg cost
      const avgCost = l.item_id === liveItemId ? liveAvgCostPerKg : Number(bal.avg_cost ?? 0);
      await client.query(
        `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, avg_cost, last_updated)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, avg_cost=$6, last_updated=now()`,
        [rec.company_id, rec.warehouse_id, l.item_id, newHeads, newKgs, avgCost],
      );
    }

    await client.query(`UPDATE tally_sheets SET status='posted', posted_by=$1, posted_at=now() WHERE id=$2`, [auth.userId, params.id]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
