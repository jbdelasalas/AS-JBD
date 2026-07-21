export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module C — Marination. Recording a run explodes the recipe BOM against the
// finished pack weight, consumes ingredient inventory (weighted-average), and
// posts the consumption journal Dr 5220 Marination Raw Materials / Cr 1145
// Inventory (the corrected consumption direction confirmed in the architecture).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT mr.id, mr.job_order_id, jo.batch_no, r.name AS recipe_name, r.code AS recipe_code,
            mr.raw_meat_weight_kg, mr.finished_weight_kg, mr.consumption_posted, mr.created_at
       FROM dp_marination_runs mr
       JOIN dp_job_orders jo ON jo.id = mr.job_order_id
       JOIN dp_recipes r ON r.id = mr.recipe_id
      WHERE jo.company_id = $1
      ORDER BY mr.created_at DESC`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const jobOrderId = dto.job_order_id as string;
  const recipeId = dto.recipe_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!jobOrderId) return err('job_order_id is required', 400);
  if (!recipeId) return err('recipe_id is required', 400);
  const finished = Number(dto.finished_weight_kg);
  if (!(finished > 0)) return err('finished_weight_kg must be greater than 0', 400);
  const rawMeat = dto.raw_meat_weight_kg != null ? Number(dto.raw_meat_weight_kg) : finished;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const runRows = await client.query<{ id: string }>(
      `INSERT INTO dp_marination_runs
         (job_order_id, recipe_id, raw_meat_weight_kg, finished_weight_kg, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [jobOrderId, recipeId, rawMeat, finished, auth.userId],
    );
    const runId = runRows.rows[0].id;

    // Explode BOM: ingredient qty = qty_per_kg × finished pack weight.
    const bom = await client.query<{ item_id: string; qty_per_kg: string }>(
      `SELECT item_id, qty_per_kg FROM dp_bom_items WHERE recipe_id = $1`,
      [recipeId],
    );

    // Resolve a warehouse for this company to deduct ingredient stock from.
    const whRow = await client.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at LIMIT 1`,
      [companyId],
    );
    const warehouseId = whRow.rows[0]?.id ?? null;

    let totalCost = 0;
    for (const line of bom.rows) {
      const qty = Number(line.qty_per_kg) * finished;
      if (!(qty > 0)) continue;
      let unitCost = 0;
      if (warehouseId) {
        const balRow = await client.query<{ avg_cost: string }>(
          `SELECT avg_cost FROM stock_balances WHERE item_id = $1 AND warehouse_id = $2 FOR UPDATE`,
          [line.item_id, warehouseId],
        );
        unitCost = Number(balRow.rows[0]?.avg_cost ?? 0);
        await client.query(
          `UPDATE stock_balances SET qty_on_hand = GREATEST(0, qty_on_hand - $1), last_movement_at = now()
            WHERE item_id = $2 AND warehouse_id = $3`,
          [qty, line.item_id, warehouseId],
        );
        await client.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
              reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'consume',$4,$5,$6,'dp_marination',$7,$8,$9)`,
          [companyId, line.item_id, warehouseId, -qty, unitCost, qty * unitCost, runId, 'MARINATION', auth.userId],
        );
      }
      totalCost += qty * unitCost;
    }
    totalCost = parseFloat(totalCost.toFixed(2));

    // Post consumption Dr 5220 / Cr 1145 through the posting engine.
    let entryId: string | null = null;
    if (totalCost > 0) {
      const branchRow = await client.query<{ branch_id: string | null }>(
        `SELECT branch_id FROM dp_job_orders WHERE id = $1`, [jobOrderId],
      );
      const je = await client.query<{ id: string }>(
        `SELECT dp_post_journal($1,'marination_consumption',$2,$3::jsonb,$4,$5,$6) AS id`,
        [
          companyId, runId,
          JSON.stringify([
            { code: '5220', dr: totalCost, cr: 0 },
            { code: '1145', dr: 0, cr: totalCost },
          ]),
          'Marination ingredients consumed',
          branchRow.rows[0]?.branch_id ?? null,
          auth.userId,
        ],
      );
      entryId = je.rows[0].id;
      await client.query(`UPDATE dp_marination_runs SET consumption_posted = true WHERE id = $1`, [runId]);
    }

    await client.query('COMMIT');
    return ok({ id: runId, ingredient_cost: totalCost, journal_entry_id: entryId }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to record marination run', 500);
  } finally {
    client.release();
  }
}
