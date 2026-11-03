export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { adjustBinBalance, binQtyOnHand, BOX_HELD_BY_PICK_SQL } from '@/lib/wms';
import { codeFor } from '@/lib/scan-codes';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const [header] = await query(
    `SELECT p.*, w.name AS warehouse_name, COALESCE(gr.grn_no, st.transfer_no, jo.batch_no) AS source_no
       FROM putaways p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN goods_receipts gr ON gr.id = p.grn_id
       LEFT JOIN stock_transfers st ON st.id = p.transfer_id
       LEFT JOIN dp_job_orders jo ON jo.id = p.job_order_id
      WHERE p.id = $1 LIMIT 1`,
    [params.id],
  );
  if (!header) return err('Put-away not found', 404);

  const lines = await query(
    `SELECT pl.*, i.sku, i.name AS item_name, i.uom, b.code AS bin_code, l.lot_no,
            po.line_no AS pack_no, po.head_count AS heads,
            x.status AS box_status, xb.code AS box_bin_code
       FROM putaway_lines pl
       JOIN items i ON i.id = pl.item_id
       JOIN bins b ON b.id = pl.bin_id
       LEFT JOIN item_lots l ON l.id = pl.lot_id
       LEFT JOIN dp_processed_output po ON po.id = pl.dp_output_id
       LEFT JOIN LATERAL (
         SELECT bx.status, bx.bin_id FROM dp_storage_boxes bx
          WHERE pl.dp_output_id IS NOT NULL AND bx.dp_output_id = pl.dp_output_id
          ORDER BY bx.created_at DESC LIMIT 1) x ON true
       LEFT JOIN bins xb ON xb.id = x.bin_id
      WHERE pl.putaway_id = $1 ORDER BY po.line_no NULLS LAST, pl.line_no`,
    [params.id],
  );
  return ok({ ...header, lines });
}

// Change the bin of put-away lines.
//   - Draft: just re-points the lines; nothing is in a bin yet.
//   - Posted: the stock is already in the old bin, so it is moved bin to bin
//     (bin sub-ledger only — the warehouse total doesn't change), the pack's
//     box follows, and the move is journalled like a scanned move. A pack that
//     has shipped or is on a pick list can't be moved from here.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const body = await request.json().catch(() => ({}));
  const changes = (Array.isArray(body.lines) ? body.lines : []) as Array<{ id: string; bin_id: string }>;
  if (!changes.length || changes.some((c) => !c.id || !c.bin_id)) return err('lines must be [{ id, bin_id }]', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const fail = async (msg: string, status = 409) => { await client.query('ROLLBACK'); return err(msg, status); };

    const { rows: [pa] } = await client.query(`SELECT * FROM putaways WHERE id = $1 FOR UPDATE`, [params.id]);
    if (!pa) return fail('Put-away not found', 404);
    if (!['draft', 'posted'].includes(String(pa.status))) return fail(`A ${pa.status} put-away can't be changed`, 400);

    const { rows: bins } = await client.query(
      `SELECT id, code, warehouse_id, is_active FROM bins WHERE id = ANY($1::uuid[])`, [changes.map((c) => c.bin_id)]);
    const binById = new Map(bins.map((b) => [String(b.id), b]));
    for (const c of changes) {
      const b = binById.get(String(c.bin_id));
      if (!b || String(b.warehouse_id) !== String(pa.warehouse_id)) return fail('A chosen bin is not in this put-away\'s warehouse', 400);
      if (!b.is_active) return fail(`Bin ${b.code} is inactive`, 400);
    }

    const { rows: lines } = await client.query(
      `SELECT pl.*, po.line_no AS pack_no FROM putaway_lines pl
         LEFT JOIN dp_processed_output po ON po.id = pl.dp_output_id
        WHERE pl.putaway_id = $1 AND pl.id = ANY($2::uuid[]) FOR UPDATE OF pl`,
      [params.id, changes.map((c) => c.id)]);
    const lineById = new Map(lines.map((l) => [String(l.id), l]));
    if (lineById.size !== new Set(changes.map((c) => c.id)).size) return fail('A line is not on this put-away', 400);

    const moveRef = (await client.query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    let changed = 0;
    for (const c of changes) {
      const l = lineById.get(String(c.id))!;
      const dest = binById.get(String(c.bin_id))!;
      const label = l.pack_no ? `pack #${l.pack_no}` : `line ${l.line_no}`;

      if (pa.status === 'posted') {
        const itemId = String(l.item_id);
        const lotId = l.lot_id ? String(l.lot_id) : null;
        let fromBin = String(l.bin_id);
        let qty = Number(l.qty);
        let boxId: string | null = null;

        if (l.dp_output_id) {
          const { rows: [box] } = await client.query(
            `SELECT x.id, x.bin_id, x.net_weight_kg, x.status, ${BOX_HELD_BY_PICK_SQL('x.id')} AS held
               FROM dp_storage_boxes x WHERE x.dp_output_id = $1 ORDER BY x.created_at DESC LIMIT 1 FOR UPDATE OF x`,
            [l.dp_output_id]);
          if (!box || box.status !== 'in_storage') return fail(`${label} has already left storage`);
          if (box.held) return fail(`${label} is on a pick list — finish or cancel the pick before moving it`);
          boxId = String(box.id);
          fromBin = String(box.bin_id ?? l.bin_id); // it may have been moved by scan since
          qty = Number(box.net_weight_kg);
        }
        if (fromBin === String(dest.id)) {
          await client.query(`UPDATE putaway_lines SET bin_id = $1 WHERE id = $2`, [dest.id, l.id]);
          continue;
        }

        const avail = await binQtyOnHand(client, itemId, fromBin, lotId);
        if (avail + 1e-9 < qty) return fail(`The old bin only holds ${avail} for ${label} (needs ${qty}) — some of it has moved or shipped`);
        const cost = Number((await client.query(
          `SELECT avg_cost FROM bin_stock_balances WHERE item_id = $1 AND bin_id = $2
             AND COALESCE(lot_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`,
          [itemId, fromBin, lotId])).rows[0]?.avg_cost ?? 0);
        await adjustBinBalance(client, String(pa.company_id), itemId, String(pa.warehouse_id), fromBin, lotId, -qty, cost);
        await adjustBinBalance(client, String(pa.company_id), itemId, String(pa.warehouse_id), String(dest.id), lotId, qty, cost);
        if (boxId) await client.query(`UPDATE dp_storage_boxes SET bin_id = $1, room = $2 WHERE id = $3`, [dest.id, dest.code, boxId]);
        await client.query(
          `INSERT INTO inventory_scan_events
             (company_id, move_ref, entity_type, entity_id, code, from_bin_id, to_bin_id, item_id, lot_id, qty, scanned_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [pa.company_id, moveRef, boxId ? 'box' : 'putaway_line', boxId ?? l.id, boxId ? codeFor('box', boxId) : null,
            fromBin, dest.id, itemId, lotId, qty, auth.userId, `Bin changed on put-away ${pa.putaway_no}`]);
      }

      await client.query(`UPDATE putaway_lines SET bin_id = $1 WHERE id = $2`, [dest.id, l.id]);
      changed++;
    }
    await client.query('COMMIT');
    return ok({ changed, moved: pa.status === 'posted' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to change bins', 500);
  } finally {
    client.release();
  }
}
