export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo, resolveLot } from '@/lib/wms';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `p.company_id = $1`;
  const status = searchParams.get('status');
  if (status && status !== 'all') { params.push(status); where += ` AND p.status = $${params.length}`; }

  const rows = await query(
    `SELECT p.id, p.putaway_no, p.status, p.created_at, p.posted_at, p.notes,
            w.name AS warehouse_name, gr.grn_no
       FROM putaways p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN goods_receipts gr ON gr.id = p.grn_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT 500`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const warehouseId = dto.warehouse_id as string;
  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);
  if (!lines?.length) return err('At least one line required', 400);
  for (const l of lines) {
    if (!l.item_id || !l.bin_id || !(Number(l.qty) > 0)) return err('Each line needs item, bin, and positive qty', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const putawayNo = await nextDocNo(client, companyId, 'putaways', 'putaway_no', 'PA');

    const { rows: [header] } = await client.query(
      `INSERT INTO putaways (company_id, putaway_no, grn_id, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, putawayNo, dto.grn_id ?? null, warehouseId, dto.notes ?? null, auth.userId],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lotId = await resolveLot(client, companyId, l.item_id as string, l.lot_no as string | undefined, l.expiry_date as string | undefined);
      await client.query(
        `INSERT INTO putaway_lines (putaway_id, line_no, item_id, bin_id, lot_id, qty, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, i + 1, l.item_id, l.bin_id, lotId, Number(l.qty), Number(l.unit_cost ?? 0)],
      );
    }

    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create put-away', 500);
  } finally { client.release(); }
}
