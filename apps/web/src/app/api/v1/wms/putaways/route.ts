export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo, resolveLot, putawaySourceRemaining, DP_OUTPUT_PUTAWAY_ELIGIBLE } from '@/lib/wms';

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
            w.name AS warehouse_name, COALESCE(gr.grn_no, st.transfer_no, jo.batch_no) AS source_no
       FROM putaways p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN goods_receipts gr ON gr.id = p.grn_id
       LEFT JOIN stock_transfers st ON st.id = p.transfer_id
       LEFT JOIN dp_job_orders jo ON jo.id = p.job_order_id
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
  const jobOrderId = (dto.job_order_id as string) || null;
  const sourceCount = [grnId, transferId, jobOrderId].filter(Boolean).length;
  if (sourceCount === 0) return err('Choose the goods receipt, stock transfer or production batch this put-away comes from', 400);
  if (sourceCount > 1) return err('A put-away comes from one source document only', 400);

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
    } else if (jobOrderId) {
      const { rows: [jo] } = await client.query(
        `SELECT id FROM dp_job_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`, [jobOrderId, companyId]);
      if (!jo) return fail('Production batch not found', 404);
      // Pack by pack: each line is one production line of this batch, not yet
      // put away; item and qty come from the pack, not the client.
      const ids = lines.map((l) => String(l.dp_output_id ?? ''));
      if (ids.some((id) => !id)) return fail('Production put-aways go pack by pack — reload the page and pick the batch again', 400);
      if (new Set(ids).size !== ids.length) return fail('The same pack is on two lines', 400);
      const { rows: packs } = await client.query(
        `SELECT po.id, po.item_id, po.weight_kg - COALESCE(po.transferred_kg, 0) AS left_kg,
                EXISTS (SELECT 1 FROM putaway_lines pl JOIN putaways p ON p.id = pl.putaway_id
                         WHERE pl.dp_output_id = po.id AND p.status <> 'cancelled') AS taken
           FROM dp_processed_output po
          WHERE po.id = ANY($1::uuid[]) AND po.job_order_id = $2 AND ${DP_OUTPUT_PUTAWAY_ELIGIBLE}
          FOR UPDATE OF po`,
        [ids, jobOrderId]);
      const byId = new Map(packs.map((p) => [String(p.id), p]));
      for (const l of lines) {
        const p = byId.get(String(l.dp_output_id));
        if (!p) return fail('A pack is not part of this batch', 400);
        if (p.taken || !(Number(p.left_kg) > 0)) return fail('A pack is already on another put-away — reload the page', 409);
        l.item_id = p.item_id;
        l.qty = Number(p.left_kg);
      }
    } else {
      const { rows: [xfr] } = await client.query(
        `SELECT status, to_warehouse_id FROM stock_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE`, [transferId, companyId]);
      if (!xfr) return fail('Transfer not found', 404);
      if (xfr.status !== 'received') return fail('Receive the transfer before putting it away', 400);
      if (String(xfr.to_warehouse_id) !== warehouseId) return fail('Transfer was received into a different warehouse', 400);
    }

    const remaining = await putawaySourceRemaining(client, { grnId, transferId, jobOrderId });
    const wanted = new Map<string, number>();
    for (const l of lines) wanted.set(String(l.item_id), (wanted.get(String(l.item_id)) ?? 0) + Number(l.qty));
    for (const [itemId, qty] of wanted) {
      const left = remaining.get(itemId);
      if (!left) return fail('A line has an item that is not on the source document', 400);
      if (qty > left.qty + 1e-9) return fail(`Only ${Math.max(left.qty, 0)} left to put away for one of the items — lower the qty`, 400);
    }

    const putawayNo = await nextDocNo(client, companyId, 'putaways', 'putaway_no', 'PA');

    const { rows: [header] } = await client.query(
      `INSERT INTO putaways (company_id, putaway_no, grn_id, transfer_id, job_order_id, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING *`,
      [companyId, putawayNo, grnId, transferId, jobOrderId, warehouseId, dto.notes ?? null, auth.userId],
    );

    // One insert for all lines (a production batch is hundreds of packs); lots
    // resolved once per item + lot.
    const lotIds = new Map<string, string | null>();
    for (const l of lines) {
      const key = `${l.item_id}|${l.lot_no ?? ''}|${l.expiry_date ?? ''}`;
      if (!lotIds.has(key)) lotIds.set(key, await resolveLot(client, companyId, l.item_id as string, l.lot_no as string | undefined, l.expiry_date as string | undefined));
    }
    await client.query(
      `INSERT INTO putaway_lines (putaway_id, line_no, item_id, bin_id, lot_id, qty, unit_cost, dp_output_id)
       SELECT $1, x.line_no, x.item_id, x.bin_id, x.lot_id, x.qty, x.unit_cost, x.dp_output_id
         FROM unnest($2::int[], $3::uuid[], $4::uuid[], $5::uuid[], $6::numeric[], $7::numeric[], $8::uuid[])
              AS x(line_no, item_id, bin_id, lot_id, qty, unit_cost, dp_output_id)`,
      [
        header.id,
        lines.map((_, i) => i + 1),
        lines.map((l) => l.item_id),
        lines.map((l) => l.bin_id),
        lines.map((l) => lotIds.get(`${l.item_id}|${l.lot_no ?? ''}|${l.expiry_date ?? ''}`) ?? null),
        lines.map((l) => Number(l.qty)),
        // Cost comes from the source document, not the client.
        lines.map((l) => remaining.get(String(l.item_id))!.unitCost),
        lines.map((l) => (jobOrderId ? String(l.dp_output_id) : null)),
      ],
    );

    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create put-away', 500);
  } finally { client.release(); }
}
