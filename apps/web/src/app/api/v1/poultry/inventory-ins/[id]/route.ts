export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT i.*, s.name AS supplier_name, s.code AS supplier_code,
              w.name AS warehouse_name, o.doc_no AS order_in_no
         FROM inventory_ins i
         JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN warehouses w ON w.id = i.warehouse_id
         LEFT JOIN order_ins o ON o.id = i.order_in_id
        WHERE i.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, it.name AS item_name, it.sku FROM inventory_in_lines l JOIN items it ON it.id = l.item_id
        WHERE l.inventory_in_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
