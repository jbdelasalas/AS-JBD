export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(`SELECT * FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
  if (!rows[0]) return err('Not found', 404);
  const cnt = rows[0] as Record<string, unknown>;
  if (cnt.status !== 'in_progress') return err('Count must be in_progress to post', 400);

  const lines = await query(
    `SELECT scl.*, i.name AS item_name, i.inventory_account_id
       FROM stock_count_lines scl
       LEFT JOIN items i ON i.id = scl.item_id
      WHERE scl.count_id = $1`, [params.id],
  );

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const l of lines) {
      const variance = Number(l.variance);
      if (Math.abs(variance) < 0.0001) continue;

      const unitCost = Number(l.unit_cost);

      await client.query(
        `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (item_id, warehouse_id) DO UPDATE
           SET qty_on_hand = stock_balances.qty_on_hand + $5,
               last_movement_at = now()`,
        [l.item_id, cnt.warehouse_id, Math.max(0, Number(l.system_qty) + variance), unitCost, variance],
      );

      await client.query(
        `INSERT INTO stock_movements
           (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_no, notes, created_by)
         VALUES ($1,$2,$3,'adjustment',$4,$5,$6,'stock_count',$7,$8,$9,$10)`,
        [
          cnt.company_id, l.item_id, cnt.warehouse_id,
          variance, unitCost, Math.abs(variance) * unitCost,
          params.id, cnt.count_no, `Count correction: ${cnt.count_no}`, auth.userId,
        ],
      );
    }

    // --- GL: Inventory Adjustment entries for each variance line ---
    let countJeId: string | null = null;
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods WHERE company_id = $1 AND CURRENT_DATE BETWEEN start_date AND end_date LIMIT 1`,
      [cnt.company_id],
    );
    const period = periodRows.rows[0];
    if (period && period.status !== 'closed') {
      const [defInvRows, adjAcctRows] = await Promise.all([
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1 AND account_type = 'ASSET'
             AND (code = '1200' OR name ILIKE '%inventory%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [cnt.company_id],
        ),
        client.query(
          `SELECT id FROM accounts WHERE company_id = $1
             AND (code = '5020' OR name ILIKE '%inventory adjustment%') AND is_active = true ORDER BY code ASC LIMIT 1`,
          [cnt.company_id],
        ),
      ]);
      const defaultInvId: string | null = defInvRows.rows[0]?.id ?? null;
      const adjAcctId: string | null = adjAcctRows.rows[0]?.id ?? null;

      if (defaultInvId && adjAcctId) {
        const jeLines: Array<{ account_id: string; description: string; debit: number; credit: number }> = [];
        for (const l of lines) {
          const la = l as Record<string, unknown>;
          const variance = Number(la.variance);
          if (Math.abs(variance) < 0.0001) continue;
          const unitCost = Number(la.unit_cost);
          const totalCost = parseFloat((Math.abs(variance) * unitCost).toFixed(2));
          if (totalCost <= 0) continue;
          const itemInvId = (la.inventory_account_id as string | null) ?? defaultInvId;
          const desc = `Count variance — ${la.item_name ?? la.item_id} (${cnt.count_no})`;
          if (variance > 0) {
            jeLines.push({ account_id: itemInvId, description: desc, debit: totalCost, credit: 0 });
            jeLines.push({ account_id: adjAcctId, description: desc, debit: 0, credit: totalCost });
          } else {
            jeLines.push({ account_id: adjAcctId, description: desc, debit: totalCost, credit: 0 });
            jeLines.push({ account_id: itemInvId, description: desc, debit: 0, credit: totalCost });
          }
        }

        if (jeLines.length > 0) {
          const seriesRows = await client.query(
            `UPDATE document_series SET current_number = current_number + 1, updated_at = now()
              WHERE company_id = $1 AND doc_type = 'journal_voucher' AND is_active = true RETURNING prefix, current_number`,
            [cnt.company_id],
          );
          if (seriesRows.rows[0]) {
            const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;
            const jeInsert = await client.query(
              `INSERT INTO journal_entries (company_id, entry_no, entry_date, fiscal_period_id,
                 reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
               VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,'inventory','stock_count',$6,'posted',$7) RETURNING id`,
              [cnt.company_id, jeNo, period.id, cnt.count_no,
               `Stock Count ${cnt.count_no} — variance adjustment`, params.id, auth.userId],
            );
            const jeId = jeInsert.rows[0].id;
            countJeId = jeId;
            for (let i = 0; i < jeLines.length; i++) {
              const jl = jeLines[i];
              await client.query(
                `INSERT INTO journal_entry_lines (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
                 VALUES ($1,$2,$3,$4,$5,$6,'PHP',1,$5,$6)`,
                [jeId, i + 1, jl.account_id, jl.description, jl.debit, jl.credit],
              );
            }
            await client.query(
              `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
               SELECT jel.account_id, $2, SUM(jel.debit), SUM(jel.credit) FROM journal_entry_lines jel WHERE jel.entry_id = $1 GROUP BY jel.account_id
               ON CONFLICT (account_id, fiscal_period_id) DO UPDATE SET
                 debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                 credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
              [jeId, period.id],
            );
            await client.query(
              `UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`,
              [jeId, auth.userId],
            );
          }
        }
      }
    }

    await client.query(
      `UPDATE stock_counts SET status='posted', posted_by=$1, posted_at=now(), updated_at=now(), je_id=$3 WHERE id=$2`,
      [auth.userId, params.id, countJeId ?? null],
    );

    await client.query('COMMIT');
    const updated = await query(`SELECT * FROM stock_counts WHERE id = $1 LIMIT 1`, [params.id]);
    return ok(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
