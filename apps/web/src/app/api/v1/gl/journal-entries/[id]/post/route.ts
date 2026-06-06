export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const id = params.id;
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const rows = await client.query(
      `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const entry = rows.rows[0];
    if (!entry) { await client.query('ROLLBACK'); return err(`Journal entry ${id} not found`, 404); }
    if (entry.status === 'posted') { await client.query('ROLLBACK'); return err('Already posted', 409); }
    if (entry.status === 'voided') { await client.query('ROLLBACK'); return err('Cannot post a voided entry', 409); }

    const totals = await client.query(
      `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
         FROM journal_entry_lines WHERE entry_id = $1`,
      [id],
    );
    const d = Number(totals.rows[0].d);
    const c = Number(totals.rows[0].c);
    if (Math.abs(d - c) > 0.0001) {
      await client.query('ROLLBACK');
      return err(`Cannot post unbalanced entry. Debit ${d} Credit ${c}`, 400);
    }
    if (d === 0) { await client.query('ROLLBACK'); return err('Cannot post entry with zero amount', 400); }

    // Block control accounts on manual entries
    if (entry.source_module === 'manual') {
      const ctrlCheck = await client.query(
        `SELECT a.code, a.name FROM journal_entry_lines jel
           JOIN accounts a ON a.id = jel.account_id
          WHERE jel.entry_id = $1 AND a.is_control = true`,
        [id],
      );
      if (ctrlCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return err(
          `Cannot post to control accounts: ${ctrlCheck.rows.map((r: Record<string, unknown>) => `${r.code} – ${r.name}`).join('; ')}. These are system-managed accounts.`,
          400,
        );
      }
    }

    const periods = await client.query(
      `SELECT status FROM fiscal_periods WHERE id = $1 LIMIT 1`,
      [entry.fiscal_period_id],
    );
    if (periods.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return err('Fiscal period is closed', 400);
    }

    await client.query(
      `UPDATE journal_entries
         SET status = 'posted', posted_at = now(), posted_by = $2, updated_at = now()
       WHERE id = $1`,
      [id, auth.userId],
    );

    await client.query(
      `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
       SELECT jel.account_id, $2, jel.debit, jel.credit
         FROM journal_entry_lines jel
        WHERE jel.entry_id = $1
       ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
          SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
              credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
      [id, entry.fiscal_period_id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, entry.company_id, 'post', 'journal_entry', id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // Return full record
  const headers = await query(
    `SELECT je.*, fp.year AS period_year, fp.period AS period_number
       FROM journal_entries je
       LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
      WHERE je.id = $1 LIMIT 1`,
    [id],
  );
  const lines = await query(
    `SELECT jel.*, a.code AS account_code, a.name AS account_name
       FROM journal_entry_lines jel
       JOIN accounts a ON a.id = jel.account_id
      WHERE jel.entry_id = $1
      ORDER BY jel.line_no`,
    [id],
  );

  return ok({
    ...headers[0],
    lines: lines.map((l) => ({
      ...l,
      debit: Number((l as Record<string, unknown>).debit),
      credit: Number((l as Record<string, unknown>).credit),
    })),
  });
}
