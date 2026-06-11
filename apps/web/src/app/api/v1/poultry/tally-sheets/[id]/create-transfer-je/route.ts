export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function toISODate(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().split('T')[0];
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }

  const body = await _req.json().catch(() => ({}));
  // transfer_price is per KG; total = price_per_kg × net_kgs
  const pricePerKg = parseFloat(String(body.transfer_price ?? '0'));
  if (!pricePerKg || pricePerKg <= 0) return err('Transfer price must be greater than zero', 400);

  // Ensure columns exist that were added post-initial schema
  await Promise.all([
    query(`ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id)`, []).catch(() => {}),
    query(`ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id)`, []).catch(() => {}),
    query(`ALTER TABLE tally_sheets ADD COLUMN IF NOT EXISTS transfer_je_id uuid REFERENCES journal_entries(id)`, []).catch(() => {}),
  ]);

  try {
    const [rec] = await query<Record<string, unknown>>(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);
    if (rec.status !== 'posted') return err('Tally sheet must be posted', 400);
    if (rec.transfer_je_id) return err('Transfer journal entry already exists for this tally sheet', 400);

    const jeDate = toISODate(rec.transfer_date) || (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
    })();

    // Check fiscal period
    const periodRows = await query<Record<string, unknown>>(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate]);
    if (!periodRows[0]) return err(`No fiscal period found for ${jeDate}. Create one in GL → Fiscal Periods.`, 400);
    if (String(periodRows[0].status).toLowerCase() === 'closed') return err(`Fiscal period for ${jeDate} is closed. Re-open it first.`, 400);
    const period = periodRows[0];

    // Determine live cost: sum DR from harvest JE if exists, else recompute from grow cycle
    let liveCost = 0;
    if (rec.je_id) {
      const drRows = await query<Record<string, unknown>>(
        `SELECT COALESCE(SUM(debit), 0) AS total FROM journal_entry_lines WHERE entry_id = $1`, [rec.je_id]);
      liveCost = parseFloat(String(drRows[0]?.total ?? '0'));
    }
    if (liveCost <= 0 && rec.grow_cycle_id) {
      const gcRows = await query<Record<string, unknown>>(
        `SELECT g.chick_price_per_head, g.heads_in, g.total_mortality
           FROM grow_cycles g WHERE g.id = $1`, [rec.grow_cycle_id]);
      const gc = gcRows[0];
      if (gc) {
        const docCost = Number(gc.chick_price_per_head ?? 0) * Number(gc.heads_in ?? 0);
        const consRows = await query<Record<string, unknown>>(
          `SELECT COALESCE(SUM(total_cost), 0) AS total FROM grow_item_consumption WHERE grow_cycle_id = $1`, [rec.grow_cycle_id]);
        const totalGrowCost = docCost + parseFloat(String(consRows[0]?.total ?? '0'));
        const totalAvailableHeads = Number(gc.heads_in ?? 0) - Number(gc.total_mortality ?? 0);
        const thisHarvestHeads = Number(rec.net_heads ?? 0);
        if (totalAvailableHeads > 0 && thisHarvestHeads > 0) {
          liveCost = parseFloat((totalGrowCost / totalAvailableHeads * thisHarvestHeads).toFixed(2));
        }
      }
    }
    if (liveCost <= 0) return err('Could not determine live cost. Ensure the harvest journal entry exists or the grow cycle has cost data.', 400);

    // Live Inventory account: from live item — try tally sheet first, fall back to grow cycle
    let resolvedLiveItemId = rec.live_item_id as string | null;
    if (!resolvedLiveItemId && rec.grow_cycle_id) {
      const [gcRow] = await query<Record<string, unknown>>(
        `SELECT live_item_id FROM grow_cycles WHERE id = $1 LIMIT 1`, [rec.grow_cycle_id]);
      resolvedLiveItemId = (gcRow?.live_item_id as string | null) ?? null;
    }
    if (!resolvedLiveItemId) return err('No live item set. Set a Harvest Item on the grow cycle first.', 400);
    const [liveItem] = await query<Record<string, unknown>>(
      `SELECT inventory_account_id, name FROM items WHERE id = $1`, [resolvedLiveItemId]);
    if (!liveItem?.inventory_account_id) return err('Live item has no inventory account set. Set it in Item Setup → Inventory Account.', 400);
    const liveInvAcctId = String(liveItem.inventory_account_id);
    const liveItemId = resolvedLiveItemId;

    // Live Buying account: expense account matching "live buying" / fallback cos+live
    const buyingRows = await query<Record<string, unknown>>(
      `SELECT id FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%live%buying%' OR name ILIKE '%buying%live%'
               OR name ILIKE '%cos%live%' OR name ILIKE '%cogs%live%' OR name ILIKE '%cost%live%')
        ORDER BY
          CASE WHEN name ILIKE '%live%buying%' OR name ILIKE '%buying%live%' THEN 0 ELSE 1 END, code
        LIMIT 1`, [rec.company_id]);
    if (!buyingRows[0]) return err('Cannot find "Live Buying" account. Create an expense account with "Live" and "Buying" in the name.', 400);
    const liveBuyingAcctId = String(buyingRows[0].id);

    // Sales DR - Live Chicken: revenue account
    const salesRows = await query<Record<string, unknown>>(
      `SELECT id FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%sales%dr%live%' OR name ILIKE '%sales%live%'
               OR name ILIKE '%revenue%live%' OR name ILIKE '%income%live%')
        ORDER BY
          CASE WHEN name ILIKE '%sales%dr%live%' THEN 0 ELSE 1 END, code
        LIMIT 1`, [rec.company_id]);
    if (!salesRows[0]) return err('Cannot find "Sales DR - Live" account. Create a revenue account with "Sales DR" and "Live" in the name.', 400);
    const salesLiveAcctId = String(salesRows[0].id);

    // Chicken Trading cost center (for the DR Live Inventory line)
    const ccRows = await query<Record<string, unknown>>(
      `SELECT id FROM cost_centers
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%chicken%trading%' OR name ILIKE '%trading%chicken%'
               OR name ILIKE '%live%trading%' OR name ILIKE '%trading%live%')
        ORDER BY code LIMIT 1`, [rec.company_id]);
    const chickenTradingCcId = ccRows[0] ? String(ccRows[0].id) : null;

    // Chicken Trading location (branch + warehouse) — destination for the live stock
    const locRows = await query<Record<string, unknown>>(
      `SELECT b.id AS branch_id, w.id AS warehouse_id
         FROM branches b
         LEFT JOIN warehouses w ON w.branch_id = b.id
        WHERE b.company_id = $1 AND b.is_active = true
          AND (b.name ILIKE '%chicken%trading%' OR b.name ILIKE '%trading%chicken%'
               OR b.name ILIKE '%live%trading%' OR b.name ILIKE '%trading%live%')
        ORDER BY b.code LIMIT 1`, [rec.company_id]);
    if (!locRows[0]) return err('Cannot find "Chicken Trading" location. Create a Location named "Chicken Trading" under Inventory → Locations.', 400);
    const tradingBranchId = String(locRows[0].branch_id);
    const tradingWarehouseId = locRows[0].warehouse_id ? String(locRows[0].warehouse_id) : null;
    if (!tradingWarehouseId) return err('"Chicken Trading" location has no warehouse. Re-create it under Inventory → Locations so a warehouse is generated.', 400);

    // Resolve SOURCE warehouses, mirroring how the post route wrote the stock:
    //  • poultry_inventory_balance was written at rec.warehouse_id
    //  • stock_balances was mirrored to the warehouse of (destination_id ?? branch_id)
    const sourcePoultryWhId: string | null = (rec.warehouse_id as string | null) ?? null;
    const srcBranchId = (rec.destination_id ?? rec.branch_id) as string | null;
    const srcWhRow = srcBranchId
      ? await query<Record<string, unknown>>(`SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [srcBranchId])
      : [];
    const sourceStockWhId: string | null = (srcWhRow[0]?.id as string | null) ?? sourcePoultryWhId;

    const liveCostAmt = parseFloat(liveCost.toFixed(2));
    const netKgs = Number(rec.net_kgs ?? 0);
    const netHeads = Number(rec.net_heads ?? 0);
    const transferPriceAmt = parseFloat((pricePerKg * netKgs).toFixed(2));
    // New cost basis at the trading location (per kg = price per kg)
    const tradingAvgCostPerKg = netKgs > 0 ? parseFloat((transferPriceAmt / netKgs).toFixed(4)) : pricePerKg;

    // Post transfer JE + stock transfer in one transaction
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const seriesRows = await client.query(
        `UPDATE document_series SET current_number = GREATEST(current_number, COALESCE((SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(document_series.prefix) + 1), '\\D', '', 'g'), '')::bigint) FROM journal_entries je WHERE je.company_id = document_series.company_id AND je.entry_no LIKE document_series.prefix || '%'), 0)) + 1, updated_at = now()
          WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true RETURNING prefix, current_number`,
        [rec.company_id]);
      if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active journal voucher series', 400); }
      const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

      const jeInsert = await client.query(
        `INSERT INTO journal_entries (company_id, entry_no, entry_date, fiscal_period_id,
           reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,'inventory','tally_sheet',$7,'posted',$8) RETURNING id`,
        [rec.company_id, jeNo, jeDate, period.id,
         rec.doc_no, `Transfer JE — ${rec.doc_no}`, params.id, auth.userId]);
      const jeId = jeInsert.rows[0].id as string;

      // Line 1 — DR: Live Buying = live cost (farm's cost of sales)
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,1,$2,$3,$4,0,'PHP',1,$4,0)`,
        [jeId, liveBuyingAcctId, `Live Buying — ${rec.doc_no}`, liveCostAmt]);

      // Line 2 — DR: Live Inventory = transfer total (tagged with Chicken Trading location + CC)
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit,
            branch_id, cost_center_id)
         VALUES ($1,2,$2,$3,$4,0,'PHP',1,$4,0, $5,$6)`,
        [jeId, liveInvAcctId, `Live Inventory IN — ${rec.doc_no}`, transferPriceAmt,
         tradingBranchId, chickenTradingCcId]);

      // Line 3 — CR: Live Inventory = live cost (reducing farm stock)
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,3,$2,$3,0,$4,'PHP',1,0,$4)`,
        [jeId, liveInvAcctId, `Live Inventory OUT — ${rec.doc_no}`, liveCostAmt]);

      // Line 4 — CR: Sales DR - Live Chicken = transfer total
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,4,$2,$3,0,$4,'PHP',1,0,$4)`,
        [jeId, salesLiveAcctId, `Sales DR - Live Chicken — ${rec.doc_no}`, transferPriceAmt]);

      await client.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit)
           FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
           debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
           credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [jeId, period.id]);
      await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);

      // ── Physical stock transfer: farm/source → Chicken Trading ─────────────
      if (netKgs > 0 || netHeads > 0) {
        // 1) poultry_inventory_balance — move OUT of source warehouse
        const srcBalRow = await client.query(
          `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
            WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
          [rec.company_id, sourcePoultryWhId, liveItemId]);
        const srcBal = srcBalRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
        const srcNewHeads = Number(srcBal.qty_heads) - netHeads;
        const srcNewKgs = Number(srcBal.qty_kgs) - netKgs;
        await client.query(
          `INSERT INTO poultry_inventory_ledger
             (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_out, kgs_out, balance_heads, balance_kgs)
           VALUES ($1,$2,$3,'transfer_out','tally_sheet',$4,$5,$6,$7,$8,$9,$10)`,
          [rec.company_id, sourcePoultryWhId, liveItemId, params.id, rec.doc_no, jeDate,
           netHeads, netKgs, srcNewHeads, srcNewKgs]);
        await client.query(
          `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, avg_cost, last_updated)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, last_updated=now()`,
          [rec.company_id, sourcePoultryWhId, liveItemId, srcNewHeads, srcNewKgs, Number(srcBal.avg_cost ?? 0)]);

        // 2) poultry_inventory_balance — move IN to Chicken Trading warehouse (new cost basis = transfer price)
        const dstBalRow = await client.query(
          `SELECT qty_heads, qty_kgs, avg_cost FROM poultry_inventory_balance
            WHERE company_id=$1 AND warehouse_id IS NOT DISTINCT FROM $2 AND item_id=$3 FOR UPDATE`,
          [rec.company_id, tradingWarehouseId, liveItemId]);
        const dstBal = dstBalRow.rows[0] ?? { qty_heads: 0, qty_kgs: 0, avg_cost: 0 };
        const dstNewHeads = Number(dstBal.qty_heads) + netHeads;
        const dstNewKgs = Number(dstBal.qty_kgs) + netKgs;
        // weighted average cost (per kg) at the trading location
        const dstNewAvg = dstNewKgs > 0
          ? parseFloat(((Number(dstBal.qty_kgs) * Number(dstBal.avg_cost ?? 0) + netKgs * tradingAvgCostPerKg) / dstNewKgs).toFixed(4))
          : tradingAvgCostPerKg;
        await client.query(
          `INSERT INTO poultry_inventory_ledger
             (company_id, warehouse_id, item_id, movement_type, source_type, source_id, source_doc_no, transaction_date, heads_in, kgs_in, unit_cost, total_cost, balance_heads, balance_kgs)
           VALUES ($1,$2,$3,'transfer_in','tally_sheet',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [rec.company_id, tradingWarehouseId, liveItemId, params.id, rec.doc_no, jeDate,
           netHeads, netKgs, tradingAvgCostPerKg, transferPriceAmt, dstNewHeads, dstNewKgs]);
        await client.query(
          `INSERT INTO poultry_inventory_balance (company_id, warehouse_id, item_id, qty_heads, qty_kgs, avg_cost, last_updated)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (company_id, warehouse_id, item_id) DO UPDATE SET qty_heads=$4, qty_kgs=$5, avg_cost=$6, last_updated=now()`,
          [rec.company_id, tradingWarehouseId, liveItemId, dstNewHeads, dstNewKgs, dstNewAvg]);

        // 3) stock_balances + stock_movements mirror (kgs only)
        if (netKgs > 0) {
          // OUT of source
          if (sourceStockWhId) {
            await client.query(
              `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
               VALUES ($1,$2,$3,$4,now())
               ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
                 qty_on_hand = GREATEST(0, stock_balances.qty_on_hand - $3),
                 last_movement_at = now()`,
              [liveItemId, sourceStockWhId, netKgs, tradingAvgCostPerKg]);
            await client.query(
              `INSERT INTO stock_movements
                 (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
                  reference_type, reference_id, reference_no, created_by)
               VALUES ($1,$2,$3,'transfer_out',$4,$5,$6,'tally_sheet',$7,$8,$9)`,
              [rec.company_id, liveItemId, sourceStockWhId, netKgs, tradingAvgCostPerKg, transferPriceAmt,
               params.id, rec.doc_no, auth.userId]);
          }
          // IN to Chicken Trading
          await client.query(
            `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
             VALUES ($1,$2,$3,$4,now())
             ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
               qty_on_hand = stock_balances.qty_on_hand + $3,
               avg_cost = CASE WHEN stock_balances.qty_on_hand + $3 > 0
                          THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4) / (stock_balances.qty_on_hand + $3)
                          ELSE $4 END,
               last_movement_at = now()`,
            [liveItemId, tradingWarehouseId, netKgs, tradingAvgCostPerKg]);
          await client.query(
            `INSERT INTO stock_movements
               (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_no, created_by)
             VALUES ($1,$2,$3,'transfer_in',$4,$5,$6,'tally_sheet',$7,$8,$9)`,
            [rec.company_id, liveItemId, tradingWarehouseId, netKgs, tradingAvgCostPerKg, transferPriceAmt,
             params.id, rec.doc_no, auth.userId]);
        }
      }

      await client.query(`UPDATE tally_sheets SET transfer_je_id = $2 WHERE id = $1`, [params.id, jeId]);
      await client.query('COMMIT');

      return ok({ je_id: jeId, je_no: jeNo, live_cost: liveCostAmt, transfer_price: transferPriceAmt });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }

  } catch (e) {
    return err((e as Error).message || 'Unexpected server error', 500);
  }
}
