export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

function mapFiling(r: Record<string, unknown>) {
  return {
    ...r,
    total_due: Number(r.total_due),
    total_paid: Number(r.total_paid),
  };
}

export async function GET(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  try {
    const rows = await query(
      `SELECT f.*, u.email AS filed_by_email
         FROM bir_filings f
         LEFT JOIN users u ON u.id = f.filed_by
        WHERE f.id = $1`,
      [params.id],
    );
    if (!rows[0]) return err('Filing not found', 404);

    const validations = await query(
      `SELECT * FROM filing_validations WHERE filing_id = $1 ORDER BY created_at`,
      [params.id],
    );

    return ok({
      ...mapFiling(rows[0] as Record<string, unknown>),
      validations,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status FROM bir_filings WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (!existing.rows[0]) return err('Filing not found', 404);

    const current = existing.rows[0];
    const updates: string[] = [];
    const vals: unknown[] = [];

    if (dto.status !== undefined) {
      if (current.status === 'filed' && dto.status !== 'amended') {
        return err('Filed returns can only be changed to amended', 400);
      }
      vals.push(dto.status); updates.push(`status = $${vals.length}`);
    }
    if (dto.filed_date !== undefined) { vals.push(dto.filed_date); updates.push(`filed_date = $${vals.length}`); }
    if (dto.reference_no !== undefined) { vals.push(dto.reference_no); updates.push(`reference_no = $${vals.length}`); }
    if (dto.total_paid !== undefined) { vals.push(Number(dto.total_paid).toFixed(2)); updates.push(`total_paid = $${vals.length}`); }
    if (dto.notes !== undefined) { vals.push(dto.notes); updates.push(`notes = $${vals.length}`); }

    if (dto.status === 'filed') {
      vals.push(auth.userId); updates.push(`filed_by = $${vals.length}`);
    }

    if (!updates.length) return err('No fields to update', 400);

    vals.push(params.id);
    await client.query(
      `UPDATE bir_filings SET ${updates.join(', ')}, updated_at = now() WHERE id = $${vals.length}`,
      vals,
    );

    await client.query('COMMIT');

    const result = await query(`SELECT * FROM bir_filings WHERE id = $1`, [params.id]);
    return ok(mapFiling(result[0] as Record<string, unknown>));
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
