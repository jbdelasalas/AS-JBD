export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { writeAuditLog } from '@/lib/gl-integrity';

// GET /api/v1/gl/bank-reconciliations?company_id=&bank_account_id=
// Lists reconciliations, newest first. bank_account_id is optional.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const bankAccountId = searchParams.get('bank_account_id');

  const params: unknown[] = [companyId];
  let where = `r.company_id = $1`;
  if (bankAccountId) {
    params.push(bankAccountId);
    where += ` AND r.bank_account_id = $${params.length}`;
  }

  const rows = await query(
    `SELECT r.id, r.bank_account_id, r.statement_date, r.statement_ending_balance,
            r.beginning_balance, r.status, r.cleared_balance, r.difference,
            r.completed_at, r.created_at,
            ba.account_name, ba.bank_name
       FROM bank_reconciliations r
       JOIN bank_accounts ba ON ba.id = r.bank_account_id
      WHERE ${where}
      ORDER BY r.statement_date DESC, r.created_at DESC`,
    params,
  );

  return ok({
    data: rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        ...row,
        statement_date: String(row.statement_date).split('T')[0],
        statement_ending_balance: Number(row.statement_ending_balance),
        beginning_balance: Number(row.beginning_balance),
        cleared_balance: row.cleared_balance === null ? null : Number(row.cleared_balance),
        difference: row.difference === null ? null : Number(row.difference),
      };
    }),
  });
}

// POST /api/v1/gl/bank-reconciliations
// Starts a reconciliation. beginning_balance defaults to the most recent
// COMPLETED reconciliation's statement_ending_balance for the same bank account.
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null);
  if (!dto?.company_id || !dto?.bank_account_id || !dto?.statement_date) {
    return err('company_id, bank_account_id and statement_date are required', 400);
  }
  if (dto.statement_ending_balance === undefined || dto.statement_ending_balance === null) {
    return err('statement_ending_balance is required', 400);
  }
  const endingBalance = Number(dto.statement_ending_balance);
  if (!Number.isFinite(endingBalance)) return err('statement_ending_balance must be a number', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Validate the bank account belongs to this company and has a GL account.
    const baRows = await client.query(
      `SELECT id, gl_account_id FROM bank_accounts WHERE id = $1 AND company_id = $2`,
      [dto.bank_account_id, dto.company_id],
    );
    const ba = baRows.rows[0];
    if (!ba) { await client.query('ROLLBACK'); return err('Bank account not found in this company', 404); }
    if (!ba.gl_account_id) {
      await client.query('ROLLBACK');
      return err('This bank account is not linked to a GL account. Link it in Settings → Bank Accounts first.', 400);
    }

    // Carry forward the prior completed reconciliation's ending balance.
    const priorRows = await client.query(
      `SELECT statement_ending_balance
         FROM bank_reconciliations
        WHERE bank_account_id = $1 AND status = 'completed'
        ORDER BY statement_date DESC, completed_at DESC
        LIMIT 1`,
      [dto.bank_account_id],
    );
    const beginningBalance = priorRows.rows[0] ? Number(priorRows.rows[0].statement_ending_balance) : 0;

    const insRows = await client.query(
      `INSERT INTO bank_reconciliations
         (company_id, bank_account_id, statement_date, statement_ending_balance, beginning_balance, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [dto.company_id, dto.bank_account_id, dto.statement_date, endingBalance, beginningBalance, dto.notes ?? null, auth.userId],
    );
    const recon = insRows.rows[0];

    await writeAuditLog(client, {
      userId: auth.userId,
      companyId: dto.company_id,
      action: 'create',
      entityType: 'bank_reconciliation',
      entityId: recon.id,
      afterState: { statement_date: dto.statement_date, statement_ending_balance: endingBalance, beginning_balance: beginningBalance },
    });

    await client.query('COMMIT');
    return ok({
      ...recon,
      statement_date: String(recon.statement_date).split('T')[0],
      statement_ending_balance: Number(recon.statement_ending_balance),
      beginning_balance: Number(recon.beginning_balance),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
