export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT i.*, c.name AS customer_name, c.code AS customer_code, c.address AS customer_address, c.tin AS customer_tin,
              d.doc_no AS delivery_no
         FROM poultry_invoices i JOIN customers c ON c.id = i.customer_id
         LEFT JOIN poultry_deliveries d ON d.id = i.delivery_id WHERE i.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, it.name AS item_name, it.sku FROM poultry_invoice_lines l JOIN items it ON it.id = l.item_id
        WHERE l.invoice_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
