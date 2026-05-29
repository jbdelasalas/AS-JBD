export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT d.*, c.name AS customer_name, c.code AS customer_code, c.address AS customer_address
         FROM poultry_deliveries d JOIN customers c ON c.id = d.customer_id WHERE d.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM poultry_delivery_lines l JOIN items i ON i.id = l.item_id
        WHERE l.delivery_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
