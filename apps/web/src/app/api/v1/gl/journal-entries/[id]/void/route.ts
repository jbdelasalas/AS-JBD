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

  let reason = '';
  try {
    const body = await request.json();
    reason = body.reason ?? '';
  } catch {
    // body optional
  }

  if (!reason || reason.trim().length < 5) {
    return err('Void reason is required (minimum 5 characters)', 400);
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
    if (entry.status === 'voided') { await client.query('ROLLBACK'); return err('Already voided', 409); }

    if (entry.status === 'posted') {
      await client.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, -jel.debit, -jel.credit
           FROM journal_entry_lines jel WHERE jel.entry_id = $1
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
            SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [id, entry.fiscal_period_id],
      );
    }

    await client.query(
      `UPDATE journal_entries
         SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3
       WHERE id = $1`,
      [id, auth.userId, reason],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [auth.userId, entry.company_id, 'void', 'journal_entry', id, JSON.stringify({ reason })],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

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
