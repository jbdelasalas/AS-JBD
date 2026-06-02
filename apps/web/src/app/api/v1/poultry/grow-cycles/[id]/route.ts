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
              b.item_id,
              i.name AS item_name, i.sku,
              li.name AS live_item_name, li.sku AS live_item_sku,
              fb.name AS building_name, fb.code AS building_code,
              br.name AS branch_name, br.code AS branch_code,
              cc.name AS cost_center_name, cc.code AS cost_center_code
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
         JOIN items i ON i.id = b.item_id
         LEFT JOIN items li ON li.id = g.live_item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
         LEFT JOIN branches br ON br.id = g.branch_id
         LEFT JOIN cost_centers cc ON cc.id = g.cost_center_id
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
    const orNull = (v: unknown) => (v as string) || null;
    await client.query(
      `UPDATE grow_cycles SET
         grow_reference             = COALESCE($2, grow_reference),
         branch_id                  = COALESCE($3, branch_id),
         building_id                = COALESCE($4, building_id),
         cost_center_id             = COALESCE($5, cost_center_id),
         start_date                 = COALESCE($6, start_date),
         expected_end_date          = COALESCE($7, expected_end_date),
         approx_heads               = COALESCE($8, approx_heads),
         est_harvest_recovery       = COALESCE($9, est_harvest_recovery),
         chick_price_per_head       = COALESCE($10, chick_price_per_head),
         approx_chick_price_per_head= COALESCE($11, approx_chick_price_per_head),
         culling_qty                = COALESCE($12, culling_qty),
         remarks                    = COALESCE($13, remarks),
         live_item_id               = COALESCE($14, live_item_id)
       WHERE id = $1`,
      [params.id,
       orNull(dto.grow_reference), orNull(dto.branch_id), orNull(dto.building_id), orNull(dto.cost_center_id),
       dto.start_date ?? null, dto.expected_end_date ?? null, dto.approx_heads ?? null,
       dto.est_harvest_recovery ?? null, dto.chick_price_per_head ?? null,
       dto.approx_chick_price_per_head ?? null, dto.culling_qty ?? null, orNull(dto.remarks),
       orNull(dto.live_item_id)],
    );

    // Daily mortality — bulk replace (delete + insert in one round-trip each)
    const dailyMortality = dto.daily_mortality as Array<{ day_no: number; qty: number }> | undefined;
    if (dailyMortality) {
      await client.query(`DELETE FROM grow_daily_mortality WHERE grow_cycle_id = $1`, [params.id]);
      const active = dailyMortality.filter(d => d.qty > 0);
      if (active.length) {
        const vals = active.map((d, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(',');
        const args: unknown[] = [params.id];
        active.forEach(d => args.push(d.day_no, d.qty));
        await client.query(`INSERT INTO grow_daily_mortality (grow_cycle_id, day_no, qty) VALUES ${vals}`, args);
      }
      // Recompute totals
      const culling = Number(dto.culling_qty ?? 0);
      const newTotal = active.reduce((s, d) => s + d.qty, 0) + culling;
      const cycleRow = await client.query(`SELECT heads_in, heads_harvested FROM grow_cycles WHERE id=$1`, [params.id]);
      const newAvail = Math.max(0, Number(cycleRow.rows[0]?.heads_in ?? 0) - newTotal - Number(cycleRow.rows[0]?.heads_harvested ?? 0));
      await client.query(`UPDATE grow_cycles SET total_mortality=$1, heads_available=$2 WHERE id=$3`, [newTotal, newAvail, params.id]);
    }

    // Weekly weights — bulk replace
    const weeklyWeights = dto.weekly_weights as Array<{ week_no: number; weight_kg: number }> | undefined;
    if (weeklyWeights?.length) {
      await client.query(`DELETE FROM grow_weekly_weights WHERE grow_cycle_id = $1`, [params.id]);
      const vals = weeklyWeights.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(',');
      const args: unknown[] = [params.id];
      weeklyWeights.forEach(w => args.push(w.week_no, w.weight_kg));
      await client.query(`INSERT INTO grow_weekly_weights (grow_cycle_id, week_no, weight_kg) VALUES ${vals}`, args);
    }

    // Item consumption — bulk replace
    const consumption = dto.item_consumption as Array<Record<string, unknown>> | undefined;
    if (consumption !== undefined) {
      await client.query(`DELETE FROM grow_item_consumption WHERE grow_cycle_id = $1`, [params.id]);
      const active = consumption.filter(c => c.item_id);
      if (active.length) {
        const vals = active.map((_, i) => `($1, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7}, $${i * 7 + 8})`).join(',');
        const args: unknown[] = [params.id];
        active.forEach((c, i) => {
          const total = Number(c.quantity ?? 0) * Number(c.unit_cost ?? 0);
          args.push(i + 1, c.item_id, c.quantity ?? 0, c.uom ?? '', c.unit_cost ?? 0, total, c.remarks ?? null);
        });
        await client.query(
          `INSERT INTO grow_item_consumption (grow_cycle_id, line_no, item_id, quantity, uom, unit_cost, total_cost, remarks) VALUES ${vals}`,
          args,
        );
      }
    }

    await client.query('COMMIT');
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'update','grow_cycle',$3)`,
      [auth.userId, existing.company_id, params.id]).catch(() => {});

    // Return full updated record
    const [updated] = await query(
      `SELECT g.*, b.batch_no, b.date_received, b.item_id,
              i.name AS item_name, i.sku,
              li.name AS live_item_name, li.sku AS live_item_sku,
              fb.name AS building_name, fb.code AS building_code,
              br.name AS branch_name, br.code AS branch_code,
              cc.name AS cost_center_name, cc.code AS cost_center_code
         FROM grow_cycles g JOIN chick_batches b ON b.id = g.batch_id JOIN items i ON i.id = b.item_id
         LEFT JOIN items li ON li.id = g.live_item_id
         LEFT JOIN farm_buildings fb ON fb.id = g.building_id
         LEFT JOIN branches br ON br.id = g.branch_id
         LEFT JOIN cost_centers cc ON cc.id = g.cost_center_id
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);
  try {
    const [rec] = await query<{ id: string; batch_id: string }>(`SELECT id, batch_id FROM grow_cycles WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);
    const [{ cnt }] = await query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM tally_sheets WHERE grow_cycle_id = $1`,
      [params.id],
    );
    if (Number(cnt) > 0) return err('Cannot delete: linked tally sheets exist', 409);
    await query(`DELETE FROM grow_item_consumption  WHERE grow_cycle_id = $1`, [params.id]);
    await query(`DELETE FROM grow_daily_mortality   WHERE grow_cycle_id = $1`, [params.id]);
    await query(`DELETE FROM grow_weekly_weights    WHERE grow_cycle_id = $1`, [params.id]);
    await query(`DELETE FROM grow_cycles            WHERE id           = $1`, [params.id]);
    // Return batch to available if it was in_growing
    await query(`UPDATE chick_batches SET status='available', heads_available=heads_in WHERE id=$1 AND status='in_growing'`, [rec.batch_id]);
    return new Response(null, { status: 204 });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
