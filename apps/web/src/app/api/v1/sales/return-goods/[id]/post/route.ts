export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }

  const [rec] = await query<Record<string, unknown>>(
    `SELECT r.*, dr.warehouse_id AS dr_warehouse_id
       FROM return_goods r
       JOIN delivery_receipts dr ON dr.id = r.dr_id
      WHERE r.id = $1 LIMIT 1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'saved') return err(`Cannot post from status: ${rec.status}`, 400);

  const lines = await query<Record<string, unknown>>(
    `SELECT l.*, i.name AS item_name,
            i.inventory_account_id, i.cogs_account_id,
            COALESCE(i.dr_revenue_account_id, i.revenue_account_id) AS revenue_account_id
       FROM return_goods_lines l
       JOIN items i ON i.id = l.item_id
      WHERE l.return_id = $1 ORDER BY l.line_no`, [params.id]);
  if (!lines.length) return err('No lines found', 400);

  const jeDate = rec.return_date
    ? String(rec.return_date).substring(0, 10)
    : new Date().toISOString().split('T')[0];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Fiscal period check
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate]);
    if (!periodRows.rows[0]) { await client.query('ROLLBACK'); return err(`No fiscal period for ${jeDate}`, 400); }
    if (String(periodRows.rows[0].status).toLowerCase() === 'closed') { await client.query('ROLLBACK'); return err(`Fiscal period for ${jeDate} is closed`, 400); }
    const period = periodRows.rows[0];

    // Restore inventory for each line
    const warehouseId = rec.dr_warehouse_id as string | null;
    for (const l of lines) {
      const qty  = Number(l.qty_return ?? 0);
      const cost = Number(l.unit_cost ?? 0);
      if (qty <= 0) continue;
      if (warehouseId) {
        await client.query(
          `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
           VALUES ($1,$2,$3,$4,now())
           ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
             qty_on_hand = stock_balances.qty_on_hand + $3,
             last_movement_at = now()`,
          [l.item_id, warehouseId, qty, cost],
        );
        await client.query(
          `INSERT INTO stock_movements (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost, reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'return',$4,$5,$6,'return_goods',$7,$8,$9)`,
          [rec.company_id, l.item_id, warehouseId, qty, cost, qty * cost, params.id, rec.return_no, auth.userId],
        );
      }
    }

    // Resolve fallback accounts
    const defRows = await Promise.all([
      client.query(`SELECT id FROM accounts WHERE company_id=$1 AND account_type='ASSET'    AND (code='1200' OR name ILIKE '%inventory%')       AND is_active=true ORDER BY code LIMIT 1`, [rec.company_id]),
      client.query(`SELECT id FROM accounts WHERE company_id=$1 AND account_type='EXPENSE'  AND (code='5010' OR name ILIKE '%cost of goods%')    AND is_active=true ORDER BY code LIMIT 1`, [rec.company_id]),
      client.query(`SELECT id FROM accounts WHERE company_id=$1 AND account_type='REVENUE'  AND is_active=true ORDER BY code LIMIT 1`, [rec.company_id]),
    ]);
    const defaultInvId  = defRows[0].rows[0]?.id as string | null ?? null;
    const defaultCogsId = defRows[1].rows[0]?.id as string | null ?? null;
    const defaultRevId  = defRows[2].rows[0]?.id as string | null ?? null;

    // AR account from customer
    const custRow = await client.query(`SELECT ar_account_id FROM customers WHERE id=$1 LIMIT 1`, [rec.customer_id]);
    let arAccountId: string | null = custRow.rows[0]?.ar_account_id ?? null;
    if (!arAccountId) {
      const ctrl = await client.query(
        `SELECT id FROM accounts WHERE company_id=$1 AND is_control=true AND account_type='ASSET' AND is_active=true ORDER BY code LIMIT 1`, [rec.company_id]);
      arAccountId = ctrl.rows[0]?.id ?? null;
    }

    // Build JE lines
    const jeLines: Array<{ account_id: string; desc: string; debit: number; credit: number }> = [];
    let totalRevAmt = 0;
    let totalCostAmt = 0;

    for (const l of lines) {
      const qty       = Number(l.qty_return ?? 0);
      const unitCost  = Number(l.unit_cost ?? 0);
      const unitPrice = Number(l.unit_price ?? 0);
      if (qty <= 0) continue;

      const revAmt  = parseFloat((unitPrice * qty).toFixed(2));
      const costAmt = parseFloat((unitCost  * qty).toFixed(2));
      totalRevAmt  += revAmt;
      totalCostAmt += costAmt;

      const revAcct  = (l.revenue_account_id as string | null) ?? defaultRevId;
      const invAcct  = (l.inventory_account_id as string | null) ?? defaultInvId;
      const cogsAcct = (l.cogs_account_id as string | null) ?? defaultCogsId;

      // DR Sales DR-Dressed (revenue reversal)
      if (revAmt > 0 && revAcct) jeLines.push({ account_id: revAcct, desc: `Return — Sales ${l.item_name} (${rec.return_no})`, debit: revAmt, credit: 0 });
      // DR Dressed Inventory (goods back in)
      if (costAmt > 0 && invAcct) jeLines.push({ account_id: invAcct, desc: `Return — Inventory ${l.item_name} (${rec.return_no})`, debit: costAmt, credit: 0 });
      // CR COS Dressed (COGS reversal)
      if (costAmt > 0 && cogsAcct) jeLines.push({ account_id: cogsAcct, desc: `Return — COGS ${l.item_name} (${rec.return_no})`, debit: 0, credit: costAmt });
      // CR AR per line (revenue amount)
      if (revAmt > 0 && arAccountId) jeLines.push({ account_id: arAccountId, desc: `Return — AR ${l.item_name} (${rec.return_no})`, debit: 0, credit: revAmt });
    }

    if (!jeLines.length) { await client.query('ROLLBACK'); return err('No valid amounts to post', 400); }
    if (!arAccountId) { await client.query('ROLLBACK'); return err('No AR account found for customer', 400); }

    // Create JE
    const seriesRows = await client.query(
      `UPDATE document_series SET current_number = GREATEST(current_number, COALESCE((SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(document_series.prefix) + 1), '\\D', '', 'g'), '')::bigint) FROM journal_entries je WHERE je.company_id = document_series.company_id AND je.entry_no LIKE document_series.prefix || '%'), 0)) + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true RETURNING prefix, current_number`,
      [rec.company_id]);
    if (!seriesRows.rows[0]) { await client.query('ROLLBACK'); return err('No active journal voucher series', 400); }
    const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

    const jeInsert = await client.query(
      `INSERT INTO journal_entries (company_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,'sales','return_goods',$7,'posted',$8) RETURNING id`,
      [rec.company_id, jeNo, jeDate, period.id, rec.return_no, `Return Goods ${rec.return_no} — DR ${rec.dr_no}`, params.id, auth.userId]);
    const jeId = jeInsert.rows[0].id as string;

    for (let i = 0; i < jeLines.length; i++) {
      const l = jeLines[i];
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
        [jeId, i + 1, l.account_id, l.desc, l.debit, l.credit]);
    }

    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
         debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
         credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [jeId, period.id]);
    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
    await client.query(`UPDATE return_goods SET status = 'posted', je_id = $2, updated_at = now() WHERE id = $1`, [params.id, jeId]);

    await client.query('COMMIT');
    return ok({ je_id: jeId, je_no: jeNo, total_revenue: totalRevAmt, total_cost: totalCostAmt });
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
