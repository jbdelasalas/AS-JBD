export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT c.*, i.name AS source_item_name, i.sku AS source_sku,
              t.doc_no AS tally_sheet_no,
              po.po_no, s.name AS supplier_name,
              br.name  AS branch_name,
              tbr.name AS target_branch_name
         FROM conversions c
         JOIN items i ON i.id = c.source_item_id
         LEFT JOIN tally_sheets t   ON t.id   = c.tally_sheet_id
         LEFT JOIN purchase_orders po ON po.id = c.po_id
         LEFT JOIN suppliers s        ON s.id  = po.supplier_id
         LEFT JOIN branches br        ON br.id = c.branch_id
         LEFT JOIN branches tbr       ON tbr.id = c.target_branch_id
        WHERE c.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const outputs = await query(
      `SELECT o.*, i.name AS item_name, i.sku FROM conversion_outputs o
         JOIN items i ON i.id = o.output_item_id
        WHERE o.conversion_id = $1 ORDER BY o.line_no`, [params.id]);
    return ok({ ...hdr, outputs });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
