export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

async function findFiscalPeriod(companyId: string, isoDate: string) {
  const rows = await query<{ id: string; status: string }>(
    `SELECT id, status FROM fiscal_periods
      WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date
      LIMIT 1`,
    [companyId, isoDate],
  );
  return rows[0];
}

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  const params: unknown[] = [companyId];
  let where = `je.company_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND je.status = $${params.length}`;
  }
  params.push(limit, offset);

  const rows = await query(
    `SELECT je.id, je.entry_no, je.entry_date, je.reference, je.memo, je.status, je.posted_at, je.created_at,
            COALESCE(SUM(jel.debit), 0) AS total_debit
       FROM journal_entries je
       LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
      WHERE ${where}
      GROUP BY je.id
      ORDER BY je.entry_date DESC, je.entry_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM journal_entries je WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => ({ ...r, total_debit: Number((r as Record<string, unknown>).total_debit) })),
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines || lines.length < 2) {
    return err('A journal entry must have at least two lines', 400);
  }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const normalizedLines: Array<Record<string, unknown> & { debit: number; credit: number }> = lines.map((l, idx) => {
    const debit = Number(l.debit ?? 0);
    const credit = Number(l.credit ?? 0);
    if (debit < 0 || credit < 0) {
      throw { status: 400, message: `Line ${idx + 1}: debit and credit must be non-negative` };
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw { status: 400, message: `Line ${idx + 1}: each line must have either a debit or a credit, not both and not neither` };
    }
    return { ...l, debit, credit };
  });

  const totalDebit = normalizedLines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = normalizedLines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    return err(`Journal entry is unbalanced. Debit: ${totalDebit.toFixed(2)} Credit: ${totalCredit.toFixed(2)}`, 400);
  }

  const period = await findFiscalPeriod(companyId, dto.entry_date as string);
  if (!period) return err(`No fiscal period defined for ${dto.entry_date}`, 400);
  if (period.status === 'closed') return err(`Fiscal period for ${dto.entry_date} is closed`, 400);

  const accountIds = [...new Set(normalizedLines.map((l) => l.account_id as string))];
  const accountRows = await query(
    `SELECT id, code, name, is_active FROM accounts WHERE id = ANY($1) AND company_id = $2`,
    [accountIds, companyId],
  );
  if (accountRows.length !== accountIds.length) {
    return err('One or more accounts not found in this company', 400);
  }
  const inactive = accountRows.filter((a) => !(a as Record<string, unknown>).is_active);
  if (inactive.length) {
    return err(
      `Inactive accounts cannot be used: ${inactive.map((a) => (a as Record<string, unknown>).code).join(', ')}`,
      400,
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Issue document number
    const seriesRows = await client.query(
      `UPDATE document_series
          SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number, end_number`,
      [companyId, 'journal_voucher'],
    );
    if (!seriesRows.rows[0]) {
      await client.query('ROLLBACK');
      return err('No active document series for journal_voucher', 400);
    }
    const { prefix, current_number, end_number } = seriesRows.rows[0];
    const n = Number(current_number);
    if (end_number !== null && n > Number(end_number)) {
      await client.query('ROLLBACK');
      return err('Document series journal_voucher has been exhausted', 400);
    }
    const entryNo = `${prefix}${String(n).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO journal_entries
         (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', 'draft', $8)
       RETURNING *`,
      [
        companyId,
        dto.branch_id ?? null,
        entryNo,
        dto.entry_date,
        period.id,
        dto.reference ?? null,
        dto.memo ?? null,
        auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < normalizedLines.length; i++) {
      const l = normalizedLines[i];
      await client.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1, $2, $3, $4, $5, $6, 'PHP', 1, $5, $6)`,
        [header.id, i + 1, l.account_id, l.description ?? null, l.debit, l.credit],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'journal_entry', header.id],
    ).catch(() => {/* non-fatal */});

    await client.query('COMMIT');

    // Fetch full record
    const fullRows = await query(
      `SELECT je.*, fp.year AS period_year, fp.period AS period_number
         FROM journal_entries je
         LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
        WHERE je.id = $1 LIMIT 1`,
      [header.id],
    );
    const jeLines = await query(
      `SELECT jel.*, a.code AS account_code, a.name AS account_name
         FROM journal_entry_lines jel
         JOIN accounts a ON a.id = jel.account_id
        WHERE jel.entry_id = $1
        ORDER BY jel.line_no`,
      [header.id],
    );

    return ok({ ...fullRows[0], lines: jeLines.map((l) => ({ ...l, debit: Number((l as Record<string, unknown>).debit), credit: Number((l as Record<string, unknown>).credit) })) }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
