export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }

  try {
    const [rec] = await query<Record<string, unknown>>(
      `SELECT ts.*, b.name AS destination_name, b.code AS destination_code
         FROM tally_sheets ts
         LEFT JOIN branches b ON b.id = ts.destination_id
        WHERE ts.id = $1`, [params.id]);
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
    // Live Inventory: from live item's inventory account
    let liveInventory: { id: string; code: string; name: string } | null = null;
    if (rec.live_item_id) {
      const [item] = await query<Record<string, unknown>>(
        `SELECT a.id, a.code, a.name
           FROM items i JOIN accounts a ON a.id = i.inventory_account_id
          WHERE i.id = $1`, [rec.live_item_id]);
      if (item) liveInventory = { id: String(item.id), code: String(item.code), name: String(item.name) };
    }

    // Live Buying: expense account matching "live buying" / "buying live" / fallback cos+live
    const buyingRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%live%buying%' OR name ILIKE '%buying%live%'
               OR name ILIKE '%cos%live%' OR name ILIKE '%cogs%live%' OR name ILIKE '%cost%live%')
        ORDER BY
          CASE WHEN name ILIKE '%live%buying%' OR name ILIKE '%buying%live%' THEN 0 ELSE 1 END, code
        LIMIT 1`, [rec.company_id]);
    const liveBuying = buyingRows[0]
      ? { id: String(buyingRows[0].id), code: String(buyingRows[0].code), name: String(buyingRows[0].name) }
      : null;

    // Sales DR - Live Chicken: revenue account, prioritise "Sales DR" naming
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

    // ── Chicken Trading cost center ────────────────────────────────────────
    const ccRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM cost_centers
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%chicken%trading%' OR name ILIKE '%trading%chicken%'
               OR name ILIKE '%live%trading%' OR name ILIKE '%trading%live%')
        ORDER BY code LIMIT 1`, [rec.company_id]);
    const chickenTradingCC = ccRows[0]
      ? { id: String(ccRows[0].id), code: String(ccRows[0].code), name: String(ccRows[0].name) }
      : null;

    // ── Destination (location for the DR Live Inventory line) ─────────────
    const destination = rec.destination_id
      ? { id: String(rec.destination_id), code: String(rec.destination_code ?? ''), name: String(rec.destination_name ?? '') }
      : null;

    return ok({
      live_cost: parseFloat(liveCost.toFixed(2)),
      net_kgs: Number(rec.net_kgs ?? 0),
      net_heads: Number(rec.net_heads ?? 0),
      already_posted: !!rec.transfer_je_id,
      accounts: { live_buying: liveBuying, live_inventory: liveInventory, sales_live: salesLive },
      chicken_trading_cc: chickenTradingCC,
      destination,
    });
  } catch (e) {
    return err((e as Error).message || 'Unexpected error', 500);
  }
}
