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

  const productType = searchParams.get('product_type');
  const params: unknown[] = [companyId];
  let where = `er.company_id = $1`;
  if (productType) { params.push(productType); where += ` AND er.product_type = $${params.length}`; }

  try {
    const rows = await query(
      `SELECT * FROM excise_rates WHERE ${where}
        ORDER BY product_type, effective_date DESC`,
      params,
    );

    return ok(rows.map((r) => ({
      ...r,
      rate_per_unit: Number((r as Record<string, unknown>).rate_per_unit),
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
  if (!dto.product_type || !dto.description || dto.rate_per_unit === undefined) {
    return err('product_type, description, and rate_per_unit are required', 400);
  }
  if (!dto.effective_date) return err('effective_date is required', 400);

  // Bootstrap defaults if first time
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT bootstrap_bir_defaults($1)`, [companyId]);

    const ins = await client.query(
      `INSERT INTO excise_rates (company_id, product_type, description, rate_per_unit, unit_of_measure, effective_date, end_date, bir_classification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        companyId, dto.product_type, dto.description, dto.rate_per_unit,
        dto.unit_of_measure ?? 'liter', dto.effective_date, dto.end_date ?? null,
        dto.bir_classification ?? null,
      ],
    );
    await client.query('COMMIT');
    const row = ins.rows[0];
    return ok({ ...row, rate_per_unit: Number(row.rate_per_unit) }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
