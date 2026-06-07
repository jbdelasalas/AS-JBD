export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// node-postgres returns DATE columns as JS Date objects; convert safely to YYYY-MM-DD
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

  try {
    const [rec] = await query<Record<string, unknown>>(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);
    if (rec.status !== 'posted') return err('Tally sheet must be posted', 400);
    if (rec.je_id) return err('Journal entry already exists', 400);
    if (!rec.grow_cycle_id) return err('No grow cycle linked. Cannot compute harvest cost without a grow cycle.', 400);

    const lines = await query<Record<string, unknown>>(
      `SELECT * FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);

    const _n = new Date();
    const jeDate = toISODate(rec.transfer_date)
      || `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;

    // Check fiscal period
    const periodRows = await query<Record<string, unknown>>(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate]);
    if (!periodRows[0]) return err(`No fiscal period found for ${jeDate}. Create one in GL → Fiscal Periods.`, 400);
    if (String(periodRows[0].status).toLowerCase() === 'closed') return err(`Fiscal period for ${jeDate} is closed. Re-open it first.`, 400);
    const period = periodRows[0];

    // Grow cycle + DOC item
    const gcRows = await query<Record<string, unknown>>(
      `SELECT g.chick_price_per_head, g.heads_in, g.total_mortality, b.item_id AS doc_item_id
         FROM grow_cycles g
         JOIN chick_batches b ON b.id = g.batch_id
        WHERE g.id = $1`,
      [rec.grow_cycle_id]);
    if (!gcRows[0]) return err('Grow cycle not found.', 400);
    const gc = gcRows[0];

    // Cost computation:
    //   avg_cost_per_head = (DOC total + feeds + medicines) ÷ (heads_in − mortality)
    //   this_harvest_cost = avg_cost_per_head × net_heads
    const docCost = Number(gc.chick_price_per_head ?? 0) * Number(gc.heads_in ?? 0);
    const totalAvailableHeads = Number(gc.heads_in ?? 0) - Number(gc.total_mortality ?? 0);
    const thisHarvestHeads = Number(rec.net_heads ?? 0);

    if (totalAvailableHeads <= 0) return err(`No available heads (heads_in − mortality = ${totalAvailableHeads}). Check grow cycle mortality records.`, 400);
    if (thisHarvestHeads <= 0) return err('This tally sheet has 0 net heads. Check the tally sheet lines.', 400);

    // Consumption breakdown by item (for proportional CR entries)
    const consRows = await query<Record<string, unknown>>(
      `SELECT c.item_id, SUM(c.total_cost) AS total_cost, i.inventory_account_id, i.name
         FROM grow_item_consumption c
         JOIN items i ON i.id = c.item_id
        WHERE c.grow_cycle_id = $1
        GROUP BY c.item_id, i.inventory_account_id, i.name`,
      [rec.grow_cycle_id]);

    const totalConsCost = consRows.reduce((s, c) => s + Number(c.total_cost ?? 0), 0);
    const totalGrowCost = docCost + totalConsCost;

    if (totalGrowCost <= 0) return err('Total grow cost is ₱0. Ensure the grow cycle has Chick Price Per Head > 0 and/or item consumption recorded.', 400);

    const thisHarvestCost = parseFloat((totalGrowCost / totalAvailableHeads * thisHarvestHeads).toFixed(2));
    if (thisHarvestCost <= 0) return err('Computed harvest cost is ₱0.', 400);

    // DR: tally line items grouped by inventory account, prorated by heads
    const lineItemIds = [...new Set(lines.map(l => String(l.item_id)))];
    const lineItemRows = await query<Record<string, unknown>>(
      `SELECT id, inventory_account_id, name FROM items WHERE id = ANY($1::uuid[])`, [lineItemIds]);
    const lineItemMap = new Map((lineItemRows).map(i => [
      String(i.id),
      { inventory_account_id: (i.inventory_account_id as string | null) ?? null, name: String(i.name) },
    ]));

    const totalLineHeads = lines.reduce((s, l) => s + Number(l.heads ?? 0), 0);
    const drByAcct = new Map<string, number>();
    for (const l of lines) {
      const heads = Number(l.heads ?? 0);
      if (heads <= 0 || totalLineHeads <= 0) continue;
      const info = lineItemMap.get(String(l.item_id));
      const acctId = info?.inventory_account_id;
      if (!acctId) return err(`Item "${info?.name ?? l.item_id}" has no inventory account set. Set it in Item Setup → Inventory Account.`, 400);
      const amount = parseFloat((thisHarvestCost * (heads / totalLineHeads)).toFixed(2));
      if (amount > 0) drByAcct.set(acctId, (drByAcct.get(acctId) ?? 0) + amount);
    }
    if (drByAcct.size === 0) return err('No tally lines with heads > 0 and inventory account set.', 400);

    // CR: DOC item account + each consumption item account, prorated by cost share
    const crByAcct = new Map<string, { amount: number; desc: string }>();
    if (docCost > 0 && gc.doc_item_id) {
      const docItemRows = await query<Record<string, unknown>>(
        `SELECT inventory_account_id FROM items WHERE id = $1 LIMIT 1`, [gc.doc_item_id]);
      const docAcctId = (docItemRows[0]?.inventory_account_id as string | null) ?? null;
      if (!docAcctId) return err('DOC (chick) item has no inventory account set. Set it in Item Setup → Inventory Account.', 400);
      const share = parseFloat(((docCost / totalGrowCost) * thisHarvestCost).toFixed(2));
      crByAcct.set(docAcctId, { amount: (crByAcct.get(docAcctId)?.amount ?? 0) + share, desc: 'DOC' });
    }
    for (const c of consRows) {
      const cCost = Number(c.total_cost ?? 0);
      const cAcctId = (c.inventory_account_id as string | null);
      if (cCost <= 0) continue;
      if (!cAcctId) return err(`Consumption item "${c.name}" has no inventory account set. Set it in Item Setup → Inventory Account.`, 400);
      const share = parseFloat(((cCost / totalGrowCost) * thisHarvestCost).toFixed(2));
      const existing = crByAcct.get(cAcctId);
      crByAcct.set(cAcctId, { amount: (existing?.amount ?? 0) + share, desc: String(c.name) });
    }
    if (crByAcct.size === 0) return err('No source inventory accounts found (DOC/feeds/medicines). Ensure items have inventory accounts set.', 400);

    // Rounding: adjust last CR so total CR = total DR exactly
    const totalDrAmt = [...drByAcct.values()].reduce((s, v) => s + v, 0);
    const totalCrAmt = [...crByAcct.values()].reduce((s, v) => s + v.amount, 0);
    const roundAdj = parseFloat((totalDrAmt - totalCrAmt).toFixed(2));
    if (roundAdj !== 0) {
      const lastKey = [...crByAcct.keys()].at(-1)!;
      const last = crByAcct.get(lastKey)!;
      crByAcct.set(lastKey, { ...last, amount: parseFloat((last.amount + roundAdj).toFixed(2)) });
    }

    // Create JE in transaction
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
         rec.doc_no, `Tally Sheet ${rec.doc_no}`, params.id, auth.userId]);
      const jeId = jeInsert.rows[0].id as string;
      let lineNo = 1;

      for (const [acctId, amount] of drByAcct) {
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [jeId, lineNo++, acctId, `Harvest — Live Chicken (${rec.doc_no})`, amount]);
      }
      for (const [acctId, val] of crByAcct) {
        if (val.amount <= 0) continue;
        await client.query(
          `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
          [jeId, lineNo++, acctId, `Harvest cost — ${val.desc} (${rec.doc_no})`, val.amount]);
      }

      await client.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit)
           FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
           debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
           credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [jeId, period.id]);
      await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
      await client.query(`UPDATE tally_sheets SET je_id = $2 WHERE id = $1`, [params.id, jeId]);
      await client.query('COMMIT');

      const [updated] = await query(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
      return ok(updated);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      return err((e as Error).message, 500);
    } finally { client.release(); }

  } catch (e) {
    return err((e as Error).message || 'Unexpected server error', 500);
  }
}
