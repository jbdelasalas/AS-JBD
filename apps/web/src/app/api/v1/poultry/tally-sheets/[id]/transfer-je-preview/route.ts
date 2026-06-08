export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }

  try {
    const [rec] = await query<Record<string, unknown>>(
      `SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);

    // ── Live cost ──────────────────────────────────────────────────────────
    let liveCost = 0;
    if (rec.je_id) {
      const drRows = await query<Record<string, unknown>>(
        `SELECT COALESCE(SUM(debit), 0) AS total FROM journal_entry_lines WHERE entry_id = $1`,
        [rec.je_id]);
      liveCost = parseFloat(String(drRows[0]?.total ?? '0'));
    }
    if (liveCost <= 0 && rec.grow_cycle_id) {
      const gcRows = await query<Record<string, unknown>>(
        `SELECT chick_price_per_head, heads_in, total_mortality FROM grow_cycles WHERE id = $1`,
        [rec.grow_cycle_id]);
      const gc = gcRows[0];
      if (gc) {
        const docCost = Number(gc.chick_price_per_head ?? 0) * Number(gc.heads_in ?? 0);
        const consRows = await query<Record<string, unknown>>(
          `SELECT COALESCE(SUM(total_cost), 0) AS total FROM grow_item_consumption WHERE grow_cycle_id = $1`,
          [rec.grow_cycle_id]);
        const totalGrowCost = docCost + parseFloat(String(consRows[0]?.total ?? '0'));
        const totalAvailableHeads = Number(gc.heads_in ?? 0) - Number(gc.total_mortality ?? 0);
        const thisHarvestHeads = Number(rec.net_heads ?? 0);
        if (totalAvailableHeads > 0 && thisHarvestHeads > 0) {
          liveCost = parseFloat((totalGrowCost / totalAvailableHeads * thisHarvestHeads).toFixed(2));
        }
      }
    }

    // ── Accounts ──────────────────────────────────────────────────────────
    // Invty-Live: from live item's inventory account
    let invtyLive: { id: string; code: string; name: string } | null = null;
    if (rec.live_item_id) {
      const [item] = await query<Record<string, unknown>>(
        `SELECT a.id, a.code, a.name
           FROM items i JOIN accounts a ON a.id = i.inventory_account_id
          WHERE i.id = $1`, [rec.live_item_id]);
      if (item) invtyLive = { id: String(item.id), code: String(item.code), name: String(item.name) };
    }

    // Cos-Live: expense account matching cos + live
    const cosRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%cos%live%' OR name ILIKE '%cogs%live%' OR name ILIKE '%cost%live%')
        ORDER BY code LIMIT 1`, [rec.company_id]);
    const cosLive = cosRows[0]
      ? { id: String(cosRows[0].id), code: String(cosRows[0].code), name: String(cosRows[0].name) }
      : null;

    // Sales-Live: prioritise "Sales DR" accounts first
    const salesRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%sales%dr%live%' OR name ILIKE '%sales%live%'
               OR name ILIKE '%revenue%live%' OR name ILIKE '%income%live%')
        ORDER BY
          CASE WHEN name ILIKE '%sales%dr%live%' THEN 0 ELSE 1 END, code
        LIMIT 1`, [rec.company_id]);
    const salesLive = salesRows[0]
      ? { id: String(salesRows[0].id), code: String(salesRows[0].code), name: String(salesRows[0].name) }
      : null;

    return ok({
      live_cost: parseFloat(liveCost.toFixed(2)),
      net_kgs: Number(rec.net_kgs ?? 0),
      net_heads: Number(rec.net_heads ?? 0),
      already_posted: !!rec.transfer_je_id,
      accounts: { cos_live: cosLive, invty_live: invtyLive, sales_live: salesLive },
    });
  } catch (e) {
    return err((e as Error).message || 'Unexpected error', 500);
  }
}
