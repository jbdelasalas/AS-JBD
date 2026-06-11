export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

/**
 * 040 — Merge existing available chick batches that share the same PO + item.
 * Sums heads and recomputes price_per_head as a heads_in-weighted average,
 * folding extra batches into the earliest one. Extra batches that are not
 * referenced by any grow cycle are deleted; any that are referenced are left
 * untouched (skipped) to preserve referential integrity.
 */
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Groups of available batches sharing company + po + item, with >1 row.
    const { rows: groups } = await client.query<{ company_id: string; po_id: string; item_id: string; n: string }>(
      `SELECT company_id, po_id, item_id, count(*)::int AS n
         FROM chick_batches
        WHERE status = 'available' AND po_id IS NOT NULL
        GROUP BY company_id, po_id, item_id
       HAVING count(*) > 1`,
    );

    let mergedGroups = 0, foldedBatches = 0, skipped = 0;

    for (const g of groups) {
      const { rows: batches } = await client.query<{
        id: string; heads_in: string; heads_available: string; price_per_head: string;
      }>(
        `SELECT id, heads_in, heads_available, price_per_head
           FROM chick_batches
          WHERE company_id = $1 AND po_id = $2 AND item_id = $3 AND status = 'available'
          ORDER BY date_received ASC, batch_no ASC`,
        [g.company_id, g.po_id, g.item_id],
      );
      if (batches.length < 2) continue;

      const keep = batches[0];
      let totalIn = Number(keep.heads_in);
      let totalAvail = Number(keep.heads_available);
      let weightedCost = Number(keep.heads_in) * Number(keep.price_per_head);
      const toDelete: string[] = [];

      for (const b of batches.slice(1)) {
        // Don't touch a batch a grow cycle already points at.
        const { rows: refs } = await client.query<{ c: string }>(
          `SELECT count(*)::int AS c FROM grow_cycles WHERE batch_id = $1`, [b.id]);
        if (Number(refs[0].c) > 0) { skipped += 1; continue; }

        totalIn     += Number(b.heads_in);
        totalAvail  += Number(b.heads_available);
        weightedCost += Number(b.heads_in) * Number(b.price_per_head);
        toDelete.push(b.id);
      }

      if (toDelete.length === 0) continue;

      const avgPrice = totalIn > 0 ? weightedCost / totalIn : Number(keep.price_per_head);
      await client.query(
        `UPDATE chick_batches
            SET heads_in = $2, heads_available = $3, price_per_head = $4
          WHERE id = $1`,
        [keep.id, totalIn, totalAvail, avgPrice],
      );
      await client.query(`DELETE FROM chick_batches WHERE id = ANY($1::uuid[])`, [toDelete]);

      mergedGroups += 1;
      foldedBatches += toDelete.length;
    }

    await client.query('COMMIT');
    results.push(`ok: 040 merged ${foldedBatches} batch(es) into ${mergedGroups} group(s); skipped ${skipped} referenced batch(es)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    results.push(`err: 040 — ${(e as Error).message}`);
  } finally {
    client.release();
  }

  return ok({ results });
}
