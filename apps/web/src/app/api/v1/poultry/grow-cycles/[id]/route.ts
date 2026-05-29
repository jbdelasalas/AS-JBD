export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT g.*, b.batch_no, b.date_received, b.heads_in AS batch_heads_in,
              i.name AS item_name, i.sku,
              fb.name AS building_name, fb.code AS building_code,
              br.name AS branch_name
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
         JOIN items i ON i.id = b.item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
         LEFT JOIN branches br ON br.id = g.branch_id
        WHERE g.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);

    const [daily, weekly, consumption] = await Promise.all([
      query(`SELECT day_no, qty FROM grow_daily_mortality WHERE grow_cycle_id = $1 ORDER BY day_no`, [params.id]),
      query(`SELECT week_no, weight_kg FROM grow_weekly_weights WHERE grow_cycle_id = $1 ORDER BY week_no`, [params.id]),
      query(
        `SELECT c.*, it.name AS item_name, it.sku FROM grow_item_consumption c
           JOIN items it ON it.id = c.item_id
          WHERE c.grow_cycle_id = $1 ORDER BY c.line_no`, [params.id]),
    ]);

    return ok({ ...hdr, daily_mortality: daily, weekly_weights: weekly, item_consumption: consumption });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const [existing] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM grow_cycles WHERE id = $1`, [params.id]);
  if (!existing) return err('Not found', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Update header fields
    await client.query(
      `UPDATE grow_cycles SET
         grow_reference             = COALESCE($2, grow_reference),
         branch_id                  = COALESCE($3, branch_id),
         building_id                = COALESCE($4, building_id),
         start_date                 = COALESCE($5, start_date),
         expected_end_date          = COALESCE($6, expected_end_date),
         approx_heads               = COALESCE($7, approx_heads),
         est_harvest_recovery       = COALESCE($8, est_harvest_recovery),
         chick_price_per_head       = COALESCE($9, chick_price_per_head),
         approx_chick_price_per_head= COALESCE($10, approx_chick_price_per_head),
         culling_qty                = COALESCE($11, culling_qty),
         remarks                    = COALESCE($12, remarks)
       WHERE id = $1`,
      [params.id, dto.grow_reference ?? null, dto.branch_id ?? null, dto.building_id ?? null,
       dto.start_date ?? null, dto.expected_end_date ?? null, dto.approx_heads ?? null,
       dto.est_harvest_recovery ?? null, dto.chick_price_per_head ?? null,
       dto.approx_chick_price_per_head ?? null, dto.culling_qty ?? null, dto.remarks ?? null],
    );

    // Upsert daily mortality (array of { day_no, qty })
    const dailyMortality = dto.daily_mortality as Array<{ day_no: number; qty: number }> | undefined;
    if (dailyMortality) {
      for (const d of dailyMortality) {
        if (d.qty > 0) {
          await client.query(
            `INSERT INTO grow_daily_mortality (grow_cycle_id, day_no, qty) VALUES ($1,$2,$3)
             ON CONFLICT (grow_cycle_id, day_no) DO UPDATE SET qty = $3`,
            [params.id, d.day_no, d.qty],
          );
        } else {
          await client.query(`DELETE FROM grow_daily_mortality WHERE grow_cycle_id=$1 AND day_no=$2`, [params.id, d.day_no]);
        }
      }
      // Recompute total_mortality from daily + culling
      const totRow = await client.query<{ t: number }>(
        `SELECT COALESCE(SUM(qty),0)::numeric AS t FROM grow_daily_mortality WHERE grow_cycle_id=$1`, [params.id]);
      const culling = Number(dto.culling_qty ?? 0);
      const newTotal = Number(totRow.rows[0]?.t ?? 0) + culling;
      const cycleRow = await client.query(`SELECT heads_in, heads_harvested FROM grow_cycles WHERE id=$1`, [params.id]);
      const newAvail = Math.max(0, Number(cycleRow.rows[0]?.heads_in ?? 0) - newTotal - Number(cycleRow.rows[0]?.heads_harvested ?? 0));
      await client.query(`UPDATE grow_cycles SET total_mortality=$1, heads_available=$2 WHERE id=$3`, [newTotal, newAvail, params.id]);
    }

    // Upsert weekly weights (array of { week_no, weight_kg })
    const weeklyWeights = dto.weekly_weights as Array<{ week_no: number; weight_kg: number }> | undefined;
    if (weeklyWeights) {
      for (const w of weeklyWeights) {
        await client.query(
          `INSERT INTO grow_weekly_weights (grow_cycle_id, week_no, weight_kg) VALUES ($1,$2,$3)
           ON CONFLICT (grow_cycle_id, week_no) DO UPDATE SET weight_kg = $3`,
          [params.id, w.week_no, w.weight_kg],
        );
      }
    }

    // Replace item consumption lines
    const consumption = dto.item_consumption as Array<Record<string, unknown>> | undefined;
    if (consumption !== undefined) {
      await client.query(`DELETE FROM grow_item_consumption WHERE grow_cycle_id = $1`, [params.id]);
      for (let i = 0; i < consumption.length; i++) {
        const c = consumption[i];
        const total = Number(c.quantity ?? 0) * Number(c.unit_cost ?? 0);
        await client.query(
          `INSERT INTO grow_item_consumption (grow_cycle_id, line_no, item_id, quantity, uom, unit_cost, total_cost, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [params.id, i + 1, c.item_id, c.quantity ?? 0, c.uom ?? 'bags', c.unit_cost ?? 0, total, c.remarks ?? null],
        );
      }
    }

    await client.query('COMMIT');
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'update','grow_cycle',$3)`,
      [auth.userId, existing.company_id, params.id]).catch(() => {});

    // Return full updated record
    const [updated] = await query(
      `SELECT g.*, b.batch_no, b.date_received, i.name AS item_name, i.sku,
              fb.name AS building_name, br.name AS branch_name
         FROM grow_cycles g JOIN chick_batches b ON b.id = g.batch_id JOIN items i ON i.id = b.item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id LEFT JOIN branches br ON br.id = g.branch_id
        WHERE g.id = $1`, [params.id]);
    const [daily2, weekly2, cons2] = await Promise.all([
      query(`SELECT day_no, qty FROM grow_daily_mortality WHERE grow_cycle_id=$1 ORDER BY day_no`, [params.id]),
      query(`SELECT week_no, weight_kg FROM grow_weekly_weights WHERE grow_cycle_id=$1 ORDER BY week_no`, [params.id]),
      query(`SELECT c.*, it.name AS item_name, it.sku FROM grow_item_consumption c JOIN items it ON it.id=c.item_id WHERE c.grow_cycle_id=$1 ORDER BY c.line_no`, [params.id]),
    ]);
    return ok({ ...updated, daily_mortality: daily2, weekly_weights: weekly2, item_consumption: cons2 });
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
