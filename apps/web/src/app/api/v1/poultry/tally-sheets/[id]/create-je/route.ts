export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }

  const [rec] = await query<Record<string, unknown>>(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);
  if (rec.status !== 'posted') return err('Tally sheet must be posted', 400);
  if (rec.je_id) return err('Journal entry already exists', 400);

  const lines = await query<Record<string, unknown>>(
    `SELECT * FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);

  // --- Diagnose ---
  const jeDate = rec.transfer_date ? String(rec.transfer_date).substring(0, 10) : new Date().toISOString().split('T')[0];

  const [periodRows, warehouseRows] = await Promise.all([
    query(`SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [rec.company_id, jeDate]),
    query(`SELECT w.id FROM warehouses w
           WHERE w.branch_id = COALESCE($1::uuid, $2::uuid) LIMIT 1`,
      [rec.destination_id, rec.branch_id]),
  ]);

  if (!periodRows[0]) return err(`No fiscal period found for ${jeDate}. Please create a fiscal period that covers this date in the GL module.`, 400);
  if ((periodRows[0] as Record<string,unknown>).status === 'closed') return err(`Fiscal period for ${jeDate} is closed. Re-open it first.`, 400);

  const tsWarehouseId: string | null = (warehouseRows[0] as Record<string,unknown>)?.id as string ?? null;
  if (!tsWarehouseId) return err('No warehouse found for the destination/branch. Please ensure a warehouse is linked to this branch.', 400);

  const [defInvRows, adjAcctRows] = await Promise.all([
    query(`SELECT id FROM accounts WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET'
             AND (code = '1200' OR name ILIKE '%inventory%') AND is_active = true ORDER BY code ASC LIMIT 1`,
      [rec.company_id]),
    query(`SELECT id FROM accounts WHERE company_id = $1
             AND (code = '5020' OR name ILIKE '%inventory adjustment%') AND is_active = true ORDER BY code ASC LIMIT 1`,
      [rec.company_id]),
  ]);

  const defaultInvId: string | null = (defInvRows[0] as Record<string,unknown>)?.id as string ?? null;
  const adjAcctId: string | null = (adjAcctRows[0] as Record<string,unknown>)?.id as string ?? null;

  if (!defaultInvId) return err('No inventory control account found (code 1200 or name containing "inventory"). Create it in Chart of Accounts.', 400);
  if (!adjAcctId) return err('No inventory adjustment account found (code 5020 or name containing "inventory adjustment"). Create it in Chart of Accounts.', 400);

  // Compute live avg cost from grow cycle
  let liveItemId: string | null = null;
  let liveAvgCostPerKg = 0;
  if (rec.grow_cycle_id) {
    const gcRows = await query<Record<string,unknown>>(
      `SELECT g.chick_price_per_head, g.heads_in, g.live_item_id,
              COALESCE(SUM(c.total_cost), 0) AS total_consumption_cost
         FROM grow_cycles g
         LEFT JOIN grow_item_consumption c ON c.grow_cycle_id = g.id
        WHERE g.id = $1
        GROUP BY g.id, g.chick_price_per_head, g.heads_in, g.live_item_id`,
      [rec.grow_cycle_id]);
    const gc = gcRows[0];
    if (gc?.live_item_id) {
      liveItemId = gc.live_item_id as string;
      const totalDocCost = Number(gc.chick_price_per_head) * Number(gc.heads_in);
      const totalConsumptionCost = Number(gc.total_consumption_cost);
      const totalGrowCost = totalDocCost + totalConsumptionCost;
      const prevKgsResult = await query<Record<string,unknown>>(
        `SELECT COALESCE(SUM(tsl.net_kgs), 0) AS prev_kgs
           FROM tally_sheet_lines tsl
           JOIN tally_sheets ts ON ts.id = tsl.tally_sheet_id
          WHERE ts.grow_cycle_id = $1 AND ts.status = 'posted' AND tsl.item_id = $2`,
        [rec.grow_cycle_id, liveItemId]);
      const totalHarvestedKgs = Number(prevKgsResult[0]?.prev_kgs ?? 0);
      if (totalHarvestedKgs > 0) liveAvgCostPerKg = totalGrowCost / totalHarvestedKgs;
    }
  }

  // Build GL lines
  const itemAcctRows = await query<Record<string,unknown>>(
    `SELECT id, inventory_account_id, name FROM items WHERE id = ANY($1::uuid[])`,
    [lines.map(l => l.item_id)]);
  const itemMap = new Map((itemAcctRows as Array<Record<string,unknown>>).map(i => [
    String(i.id), { name: String(i.name), inventory_account_id: (i.inventory_account_id as string|null) ?? null }]));

  const jeLines: Array<{ account_id: string; description: string; debit: number; credit: number }> = [];
  let totalAmount = 0;
  for (const l of lines) {
    const netKgs = Number(l.net_kgs ?? 0);
    if (netKgs <= 0) continue;
    const avgCost = l.item_id === liveItemId ? liveAvgCostPerKg : Number((l as Record<string,unknown>).unit_cost ?? 0);
    const amount = parseFloat((netKgs * avgCost).toFixed(2));
    if (amount <= 0) continue;
    const info = itemMap.get(String(l.item_id));
    const itemInvId = info?.inventory_account_id ?? defaultInvId;
    jeLines.push({ account_id: itemInvId, description: `Harvest — ${info?.name ?? l.item_id} (${rec.doc_no})`, debit: amount, credit: 0 });
    totalAmount = parseFloat((totalAmount + amount).toFixed(2));
  }

  if (jeLines.length === 0 || totalAmount <= 0) {
    const costDiag = liveItemId
      ? `Grow cycle live item cost is ₱${liveAvgCostPerKg.toFixed(4)}/kg. Set chick price and consumption costs on the grow cycle to generate a non-zero value.`
      : `Grow cycle has no Live Item set. Edit the grow cycle (${rec.grow_cycle_id}) and select a Live Item to enable costing.`;
    return err(`Journal entry cannot be created: all lines have ₱0 amount. ${costDiag}`, 400);
  }

  // Create JE
  const period = periodRows[0] as Record<string,unknown>;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    jeLines.push({ account_id: adjAcctId, description: `Harvest recognition (${rec.doc_no})`, debit: 0, credit: totalAmount });
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
    const jeId = jeInsert.rows[0].id;
    for (let i = 0; i < jeLines.length; i++) {
      const jl = jeLines[i];
      await client.query(
        `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
        [jeId, i + 1, jl.account_id, jl.description, jl.debit, jl.credit]);
    }
    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
         debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
         credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [jeId, period.id]);
    await client.query(`UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`, [jeId, auth.userId]);
    await client.query(`UPDATE tally_sheets SET je_id = $2 WHERE id = $1`, [params.id, jeId]);
    await client.query('COMMIT');
    const [updated] = await query(`SELECT * FROM tally_sheets WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
