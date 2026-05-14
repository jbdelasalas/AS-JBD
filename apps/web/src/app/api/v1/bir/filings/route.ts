export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapFiling(r: Record<string, unknown>) {
  return {
    ...r,
    total_due: Number(r.total_due),
    total_paid: Number(r.total_paid),
  };
}

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const year = searchParams.get('year');
  const status = searchParams.get('status');
  const formCode = searchParams.get('form_code');

  const params: unknown[] = [companyId];
  let where = `f.company_id = $1`;
  if (year) { params.push(parseInt(year)); where += ` AND f.period_year = $${params.length}`; }
  if (status) { params.push(status); where += ` AND f.status = $${params.length}`; }
  if (formCode) { params.push(formCode); where += ` AND f.form_code = $${params.length}`; }

  try {
    const rows = await query(
      `SELECT f.*, u.email AS filed_by_email
         FROM bir_filings f
         LEFT JOIN users u ON u.id = f.filed_by
        WHERE ${where}
        ORDER BY f.period_year DESC, f.period_quarter DESC NULLS LAST, f.period_month DESC NULLS LAST, f.form_code`,
      params,
    );

    return ok(rows.map((r) => mapFiling(r as Record<string, unknown>)));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.form_code) return err('form_code is required', 400);
  if (!dto.period_year) return err('period_year is required', 400);
  if (!dto.due_date) return err('due_date is required', 400);

  const FORM_NAMES: Record<string, string> = {
    '2550M': 'Monthly VAT Declaration',
    '2550Q': 'Quarterly VAT Return',
    '1601-EQ': 'Quarterly Remittance Return of Creditable Income Taxes Withheld',
    '1601-C': 'Monthly Remittance Return of Income Taxes Withheld on Compensation',
    '1604-E': 'Annual Information Return of Creditable Income Taxes Withheld',
    '0619-E': 'Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded)',
    '1702Q': 'Quarterly Income Tax Return',
    '1702RT': 'Annual Income Tax Return (Regular)',
  };

  const formCode = dto.form_code as string;
  const formName = FORM_NAMES[formCode] ?? formCode;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Compute totals for VAT filings automatically
    let totalDue = Number(dto.total_due ?? 0);
    if (formCode === '2550Q' && dto.period_quarter) {
      const computed = await client.query(
        `SELECT compute_vat_return_2550q($1, $2, $3) AS result`,
        [companyId, dto.period_year, dto.period_quarter],
      );
      const result = computed.rows[0].result;
      totalDue = Number(result.vat_payable ?? 0);
    } else if (formCode === '1601-EQ' && dto.period_quarter) {
      const computed = await client.query(
        `SELECT compute_ewt_return_1601eq($1, $2, $3) AS result`,
        [companyId, dto.period_year, dto.period_quarter],
      );
      const result = computed.rows[0].result;
      totalDue = Number(result.total_withheld ?? 0);
    }

    const ins = await client.query(
      `INSERT INTO bir_filings
         (company_id, form_code, form_name, period_type, period_year, period_month,
          period_quarter, due_date, status, total_due, total_paid, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,0,$10)
       RETURNING *`,
      [
        companyId, formCode, formName,
        dto.period_type ?? (dto.period_month ? 'monthly' : 'quarterly'),
        dto.period_year, dto.period_month ?? null, dto.period_quarter ?? null,
        dto.due_date, totalDue.toFixed(2), dto.notes ?? null,
      ],
    );

    // Run basic validations
    const filingId = ins.rows[0].id;
    const validations: Array<{ type: string; field: string | null; msg: string }> = [];

    if (totalDue <= 0) {
      validations.push({ type: 'warning', field: 'total_due', msg: 'Total due is zero — verify computed amounts before filing.' });
    }

    for (const v of validations) {
      await client.query(
        `INSERT INTO filing_validations (filing_id, validation_type, field_name, message)
         VALUES ($1, $2, $3, $4)`,
        [filingId, v.type, v.field, v.msg],
      ).catch(() => {});
    }

    await client.query('COMMIT');

    const result = await query(`SELECT * FROM bir_filings WHERE id = $1`, [filingId]);
    return ok(mapFiling(result[0] as Record<string, unknown>), 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
