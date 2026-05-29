export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT t.*, g.doc_no AS grow_cycle_no FROM tally_sheets t
         LEFT JOIN grow_cycles g ON g.id = t.grow_cycle_id WHERE t.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM tally_sheet_lines l JOIN items i ON i.id = l.item_id
        WHERE l.tally_sheet_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
