export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { id } = params;
  if (!id) return err('id is required', 400);

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

    const current = await client.query(
      `SELECT id FROM tax_codes WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!current.rows[0]) { await client.query('ROLLBACK'); return err('Tax code not found', 404); }

    const dup = await client.query(
      `SELECT id FROM tax_codes WHERE company_id = $1 AND code = $2 AND id <> $3`,
      [companyId, dto.code, id],
    );
    if (dup.rows[0]) { await client.query('ROLLBACK'); return err(`Tax code ${dto.code} already exists`, 409); }

    const upd = await client.query(
      `UPDATE tax_codes
          SET code = $1, name = $2, tax_type = $3, rate_pct = $4,
              account_id = $5, bir_atc_code = $6, is_active = COALESCE($7, is_active)
        WHERE id = $8 AND company_id = $9
        RETURNING *`,
      [
        dto.code, dto.name, dto.tax_type, dto.rate_pct,
        dto.account_id ?? null, dto.bir_atc_code ?? null,
        dto.is_active ?? null, id, companyId,
      ],
    );

    await client.query('COMMIT');
    const row = upd.rows[0];
    return ok({ ...row, rate_pct: Number(row.rate_pct) });
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
