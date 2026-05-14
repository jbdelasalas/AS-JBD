export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const taxType = searchParams.get('tax_type');
  const params: unknown[] = [companyId];
  let where = `tc.company_id = $1`;
  if (taxType) { params.push(taxType); where += ` AND tc.tax_type = $${params.length}`; }

  try {
    const rows = await query(
      `SELECT tc.*, a.name AS account_name, a.code AS account_code
         FROM tax_codes tc
         LEFT JOIN accounts a ON a.id = tc.account_id
        WHERE ${where}
        ORDER BY tc.tax_type, tc.code`,
      params,
    );

    return ok(rows.map((r) => ({
      ...r,
      rate_pct: Number((r as Record<string, unknown>).rate_pct),
    })));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code || !dto.name || !dto.tax_type || dto.rate_pct === undefined) {
    return err('code, name, tax_type, and rate_pct are required', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM tax_codes WHERE company_id = $1 AND code = $2`,
      [companyId, dto.code],
    );
    if (existing.rows[0]) return err(`Tax code ${dto.code} already exists`, 409);

    const ins = await client.query(
      `INSERT INTO tax_codes (company_id, code, name, tax_type, rate_pct, account_id, bir_atc_code, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       RETURNING *`,
      [
        companyId, dto.code, dto.name, dto.tax_type, dto.rate_pct,
        dto.account_id ?? null, dto.bir_atc_code ?? null,
      ],
    );

    await client.query('COMMIT');
    const row = ins.rows[0];
    return ok({ ...row, rate_pct: Number(row.rate_pct) }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
