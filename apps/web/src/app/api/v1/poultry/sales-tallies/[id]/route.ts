export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT s.*, c.name AS customer_name, c.code AS customer_code
         FROM sales_tally_sheets s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM sales_tally_lines l JOIN items i ON i.id = l.item_id
        WHERE l.sales_tally_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);

  const [rec] = await query<{ id: string; status: string; company_id: string }>(
    `SELECT id, status, company_id FROM sales_tally_sheets WHERE id = $1`, [params.id]);
  if (!rec) return err('Not found', 404);

  const [{ cnt }] = await query<{ cnt: number }>(
    `SELECT count(*)::int AS cnt FROM poultry_deliveries WHERE sales_tally_id = $1 AND status != 'voided'`, [params.id]);
  if (Number(cnt) > 0) return err('Cannot delete: linked deliveries exist', 409);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM sales_tally_lines  WHERE sales_tally_id = $1`, [params.id]);
    await client.query(`DELETE FROM sales_tally_sheets WHERE id             = $1`, [params.id]);
    await client.query('COMMIT');
    return new Response(null, { status: 204 });
  } catch (e) { await client.query('ROLLBACK'); return err((e as Error).message, 500); }
  finally { client.release(); }
}
