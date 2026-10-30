export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo, resolveLot, putawaySourceRemaining } from '@/lib/wms';

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
            w.name AS warehouse_name, COALESCE(gr.grn_no, st.transfer_no) AS source_no
       FROM putaways p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN goods_receipts gr ON gr.id = p.grn_id
       LEFT JOIN stock_transfers st ON st.id = p.transfer_id
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

  // Every put-away needs a source document. Bin stock only moves the qty the
  // source already added to the warehouse total, so a put-away with no source
  // (or more qty than the source has left) would push bins above the warehouse.
  const grnId = (dto.grn_id as string) || null;
  const transferId = (dto.transfer_id as string) || null;
  if (!grnId && !transferId) return err('Choose the goods receipt or stock transfer this put-away comes from', 400);
  if (grnId && transferId) return err('A put-away comes from a goods receipt or a transfer, not both', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the source so two put-aways can't claim the same qty at once.
    const fail = async (msg: string, status: number) => { await client.query('ROLLBACK'); return err(msg, status); };
    if (grnId) {
      const { rows: [gr] } = await client.query(
        `SELECT status, warehouse_id FROM goods_receipts WHERE id = $1 AND company_id = $2 FOR UPDATE`, [grnId, companyId]);
      if (!gr) return fail('Goods receipt not found', 404);
      if (gr.status !== 'posted') return fail('Post the goods receipt before putting it away', 400);
      if (String(gr.warehouse_id) !== warehouseId) return fail('Goods receipt was received into a different warehouse', 400);
    } else {
      const { rows: [xfr] } = await client.query(
        `SELECT status, to_warehouse_id FROM stock_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [transferId, companyId]);
      if (!xfr) return fail('Transfer not found', 404);
      if (xfr.status !== 'received') return fail('Receive the transfer before putting it away', 400);
      if (String(xfr.to_warehouse_id) !== warehouseId) return fail('Transfer was received into a different warehouse', 400);
    }

    const remaining = await putawaySourceRemaining(client, { grnId, transferId });
    const wanted = new Map<string, number>();
    for (const l of lines) wanted.set(String(l.item_id), (wanted.get(String(l.item_id)) ?? 0) + Number(l.qty));
    for (const [itemId, qty] of wanted) {
      const left = remaining.get(itemId);
      if (!left) return fail('A line has an item that is not on the source document', 400);
      if (qty > left.qty + 1e-9) return fail(`Only ${Math.max(left.qty, 0)} left to put away for one of the items — lower the qty`, 400);
    }

    const putawayNo = await nextDocNo(client, companyId, 'putaways', 'putaway_no', 'PA');

    const { rows: [header] } = await client.query(
      `INSERT INTO putaways (company_id, putaway_no, grn_id, transfer_id, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING *`,
      [companyId, putawayNo, grnId, transferId, warehouseId, dto.notes ?? null, auth.userId],
    );

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lotId = await resolveLot(client, companyId, l.item_id as string, l.lot_no as string | undefined, l.expiry_date as string | undefined);
      await client.query(
        `INSERT INTO putaway_lines (putaway_id, line_no, item_id, bin_id, lot_id, qty, unit_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        // Cost comes from the source document, not the client.
        [header.id, i + 1, l.item_id, l.bin_id, lotId, Number(l.qty), remaining.get(String(l.item_id))!.unitCost],
      );
    }

    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create put-away', 500);
  } finally { client.release(); }
}
