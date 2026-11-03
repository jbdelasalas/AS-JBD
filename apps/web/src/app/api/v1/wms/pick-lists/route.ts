export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { nextDocNo, PICKABLE_SO_STATUSES, SO_OPEN_TO_PICK_SQL, BOX_HELD_BY_PICK_SQL } from '@/lib/wms';

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
    `SELECT p.id, p.pick_no, p.status, p.created_at, p.picked_at, p.packed_at, p.notes,
            w.name AS warehouse_name, so.order_no, c.name AS customer_name
       FROM pick_lists p
       JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN sales_orders so ON so.id = p.so_id
       LEFT JOIN customers c ON c.id = so.customer_id
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
  const soId = dto.so_id as string;
  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!companyId || !warehouseId) return err('company_id and warehouse_id are required', 400);
  // Picking is driven by the sales order: only its items, up to what is still open.
  if (!soId) return err('Choose the sales order this pick list is for', 400);
  if (!lines?.length) return err('At least one line required', 400);
  // A line is either one pack (box_id: the whole pack is picked) or loose stock
  // (item + bin + qty).
  for (const l of lines) {
    if (l.box_id) continue;
    if (!l.item_id || !l.bin_id || !(Number(l.qty_to_pick) > 0)) return err('Each line needs item, bin, and positive qty', 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const fail = async (msg: string, status: number) => { await client.query('ROLLBACK'); return err(msg, status); };

    // Lock the order so two pick lists can't claim the same open qty at once.
    const { rows: [so] } = await client.query(
      `SELECT order_no, status, warehouse_id FROM sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`, [soId, companyId]);
    if (!so) return fail('Sales order not found', 404);
    if (!PICKABLE_SO_STATUSES.includes(String(so.status))) return fail(`Sales order ${so.order_no} is ${so.status} — only approved orders can be picked`, 400);
    if (so.warehouse_id && String(so.warehouse_id) !== warehouseId) return fail(`Sales order ${so.order_no} ships from a different warehouse`, 400);

    // Packs: lock them and take item/bin/lot/qty from the box itself.
    const boxIds = lines.filter((l) => l.box_id).map((l) => String(l.box_id));
    if (new Set(boxIds).size !== boxIds.length) return fail('The same pack is on the list twice', 400);
    if (boxIds.length) {
      const { rows: boxes } = await client.query(
        `SELECT x.id, x.item_id, x.bin_id, x.lot_id, x.net_weight_kg, x.status, x.warehouse_id,
                ${BOX_HELD_BY_PICK_SQL('x.id')} AS held
           FROM dp_storage_boxes x WHERE x.id = ANY($1::uuid[]) AND x.company_id = $2 FOR UPDATE OF x`,
        [boxIds, companyId]);
      const byId = new Map(boxes.map((b) => [String(b.id), b]));
      for (const l of lines.filter((x) => x.box_id)) {
        const b = byId.get(String(l.box_id));
        if (!b) return fail('A pack on the list no longer exists', 404);
        if (b.status !== 'in_storage' || String(b.warehouse_id) !== warehouseId || !b.bin_id) return fail('A pack on the list is no longer in a bin of this warehouse', 409);
        if (b.held) return fail('A pack on the list is already on another pick list', 409);
        Object.assign(l, { item_id: b.item_id, bin_id: b.bin_id, lot_id: b.lot_id, qty_to_pick: Number(b.net_weight_kg) });
      }
    }

    const { rows: open } = await client.query(SO_OPEN_TO_PICK_SQL, [[soId]]);
    const openByItem = new Map(open.map((r) => [String(r.item_id), Number(r.open_qty)]));
    const wanted = new Map<string, number>();
    const smallestPack = new Map<string, number>();
    for (const l of lines) {
      const k = String(l.item_id), q = Number(l.qty_to_pick);
      wanted.set(k, (wanted.get(k) ?? 0) + q);
      if (l.box_id) smallestPack.set(k, Math.min(smallestPack.get(k) ?? Infinity, q));
    }
    for (const [itemId, qty] of wanted) {
      if (!openByItem.has(itemId)) return fail(`A line has an item that is not on sales order ${so.order_no}`, 400);
      const left = Math.max(openByItem.get(itemId)!, 0);
      // Packs go whole, so the last one may take the item past the order — but
      // only by less than a pack (dropping any pack would leave it short).
      const slack = smallestPack.has(itemId) ? smallestPack.get(itemId)! - 1e-6 : 1e-9;
      if (qty > left + slack) return fail(`Only ${left} still open to pick for one of the items on ${so.order_no} — ${smallestPack.has(itemId) ? 'take off a pack' : 'lower the qty'}`, 400);
    }

    const pickNo = await nextDocNo(client, companyId, 'pick_lists', 'pick_no', 'PCK');
    const { rows: [header] } = await client.query(
      `INSERT INTO pick_lists (company_id, pick_no, so_id, warehouse_id, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6) RETURNING *`,
      [companyId, pickNo, soId, warehouseId, dto.notes ?? null, auth.userId],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO pick_list_lines (pick_id, line_no, item_id, bin_id, lot_id, qty_to_pick, box_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, i + 1, l.item_id, l.bin_id, l.lot_id ?? null, Number(l.qty_to_pick), l.box_id ?? null],
      );
    }
    await client.query('COMMIT');
    return ok(header, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to create pick list', 500);
  } finally { client.release(); }
}
