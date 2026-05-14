export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId   = searchParams.get('company_id');
  const reportSlug  = searchParams.get('report_slug');
  if (!companyId) return err('company_id is required', 400);

  try {
    const params: unknown[] = [companyId, auth.userId];
    let where = `sv.company_id = $1 AND (sv.visibility = 'company' OR sv.user_id = $2)`;
    if (reportSlug) { params.push(reportSlug); where += ` AND sv.report_slug = $${params.length}`; }

    const rows = await query(
      `SELECT sv.*, u.email AS owner_email
         FROM saved_views sv
         JOIN users u ON u.id = sv.user_id
        WHERE ${where}
        ORDER BY sv.report_slug, sv.name`,
      params,
    );
    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  if (!dto.company_id || !dto.report_slug || !dto.name) {
    return err('company_id, report_slug, and name are required', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO saved_views (user_id, company_id, report_slug, name, filters, visibility)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        auth.userId, dto.company_id, dto.report_slug, dto.name,
        JSON.stringify(dto.filters ?? {}),
        dto.visibility ?? 'personal',
      ],
    );
    await client.query('COMMIT');
    return ok(ins.rows[0], 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return err('id is required', 400);

  try {
    const rows = await query(
      `DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, auth.userId],
    );
    if (!rows[0]) return err('View not found or not owned by you', 404);
    return ok({ deleted: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
