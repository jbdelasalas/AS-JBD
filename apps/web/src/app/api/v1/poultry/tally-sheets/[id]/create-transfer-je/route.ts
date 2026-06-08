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
  const transferPrice = parseFloat(String(body.transfer_price ?? '0'));
  if (!transferPrice || transferPrice <= 0) return err('Transfer price must be greater than zero', 400);

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

    // Invty-Live account: from live_item_id
    if (!rec.live_item_id) return err('No live item set on this tally sheet', 400);
    const [liveItem] = await query<Record<string, unknown>>(
      `SELECT inventory_account_id, name FROM items WHERE id = $1`, [rec.live_item_id]);
    if (!liveItem?.inventory_account_id) return err('Live item has no inventory account set. Set it in Item Setup → Inventory Account.', 400);
    const invtyLiveAcctId = String(liveItem.inventory_account_id);

    // Cos-Live account: expense account with "cos" and "live" in name
    const cosRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%cos%live%' OR name ILIKE '%cogs%live%' OR name ILIKE '%cost%live%')
        ORDER BY code LIMIT 1`, [rec.company_id]);
    if (!cosRows[0]) return err('Cannot find "Cos - Live" account. Create an expense account with "Cos" and "Live" in the name.', 400);
    const cosLiveAcctId = String(cosRows[0].id);

    // Sales-Live account: prioritise "Sales DR - Live" accounts (e.g. "Sales DR - Live Chicken")
    const salesRows = await query<Record<string, unknown>>(
      `SELECT id, code, name FROM accounts
        WHERE company_id = $1 AND is_active = true
          AND (name ILIKE '%sales%dr%live%' OR name ILIKE '%sales%live%'
               OR name ILIKE '%revenue%live%' OR name ILIKE '%income%live%')
        ORDER BY
          CASE WHEN name ILIKE '%sales%dr%live%' THEN 0 ELSE 1 END, code
        LIMIT 1`, [rec.company_id]);
    if (!salesRows[0]) return err('Cannot find "Sales DR - Live" account. Create a revenue account with "Sales DR" and "Live" in the name.', 400);
    const salesLiveAcctId = String(salesRows[0].id);

    const liveCostAmt = parseFloat(liveCost.toFixed(2));
    const transferPriceAmt = parseFloat(transferPrice.toFixed(2));

    // Post transfer JE in transaction
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const seriesRows = await client.query(
        `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
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

      // DR: Cos-Live = live cost
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,1,$2,$3,$4,0,'PHP',1,$4,0)`,
        [jeId, cosLiveAcctId, `Transfer — Cos-Live (${rec.doc_no})`, liveCostAmt]);
      // DR: Invty-Live = transfer price
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,2,$2,$3,$4,0,'PHP',1,$4,0)`,
        [jeId, invtyLiveAcctId, `Transfer — Invty-Live IN (${rec.doc_no})`, transferPriceAmt]);
      // CR: Invty-Live = live cost
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,3,$2,$3,0,$4,'PHP',1,0,$4)`,
        [jeId, invtyLiveAcctId, `Transfer — Invty-Live OUT (${rec.doc_no})`, liveCostAmt]);
      // CR: Sales-Live = transfer price
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,4,$2,$3,0,$4,'PHP',1,0,$4)`,
        [jeId, salesLiveAcctId, `Transfer — Sales-Live (${rec.doc_no})`, transferPriceAmt]);

      await client.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit)
           FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
           debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
           credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [jeId, period.id]);
      await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
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
