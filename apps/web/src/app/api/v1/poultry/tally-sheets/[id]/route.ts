export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT t.*,
              g.doc_no  AS grow_cycle_no,
              s.name    AS supplier_name,
              d.name    AS destination_name,
              br.code   AS branch_code,    br.name  AS branch_name,
              fb.code   AS building_code,  fb.name  AS building_name,
              cc.code   AS cost_center_code, cc.name AS cost_center_name,
              gr.code   AS grow_ref_code,  gr.name  AS grow_ref_name
         FROM tally_sheets t
         LEFT JOIN grow_cycles g  ON g.id  = t.grow_cycle_id
         LEFT JOIN suppliers s    ON s.id  = t.supplier_id
         LEFT JOIN branches d     ON d.id  = t.destination_id
         LEFT JOIN branches br    ON br.id = t.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = t.building_id
         LEFT JOIN cost_centers cc   ON cc.id = t.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = t.grow_reference_id
        WHERE t.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM tally_sheet_lines l
         JOIN items i ON i.id = l.item_id
        WHERE l.tally_sheet_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const [existing] = await query<{ status: string }>(
    `SELECT status FROM tally_sheets WHERE id = $1`, [params.id]);
  if (!existing) return err('Not found', 404);
  if (existing.status !== 'saved') return err('Only saved tally sheets can be edited', 400);

  const orNull = (v: unknown) => (v as string) || null;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Update editable header fields
    await client.query(
      `UPDATE tally_sheets SET
         reference_id      = COALESCE($2, reference_id),
         supplier_id       = $3,
         destination_id    = $4,
         transfer_date     = COALESCE($5, transfer_date),
         harvested_heads   = COALESCE($6, harvested_heads),
         reject_kgs        = COALESCE($7, reject_kgs),
         reject_heads      = COALESCE($8, reject_heads),
         replacement_kgs   = COALESCE($9, replacement_kgs),
         replacement_heads = COALESCE($10, replacement_heads),
         received_by       = $11,
         issued_by         = $12,
         checked_by        = $13,
         delivery_method   = $14,
         plate_number      = $15,
         driver            = $16,
         helper            = $17,
         start_time        = $18,
         end_time          = $19,
         remarks           = $20,
         branch_id         = $21,
         building_id       = $22,
         cost_center_id    = $23,
         grow_reference_id = $24
       WHERE id = $1`,
      [params.id,
       orNull(dto.reference_id),
       orNull(dto.supplier_id),
       orNull(dto.destination_id),
       orNull(dto.transfer_date),
       dto.harvested_heads ?? null,
       dto.reject_kgs ?? null,
       dto.reject_heads ?? null,
       dto.replacement_kgs ?? null,
       dto.replacement_heads ?? null,
       orNull(dto.received_by),
       orNull(dto.issued_by),
       orNull(dto.checked_by),
       orNull(dto.delivery_method),
       orNull(dto.plate_number),
       orNull(dto.driver),
       orNull(dto.helper),
       orNull(dto.start_time),
       orNull(dto.end_time),
       orNull(dto.remarks),
       orNull(dto.branch_id),
       orNull(dto.building_id),
       orNull(dto.cost_center_id),
       orNull(dto.grow_reference_id),
      ],
    );

    // Replace lines if provided
    const lines = dto.lines as Array<Record<string, unknown>> | undefined;
    if (lines !== undefined) {
      await client.query(`DELETE FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);
      const active = lines.filter(l => l.item_id);
      if (active.length) {
        const vals = active.map((_, i) => `($1,$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4},$${i * 8 + 5},$${i * 8 + 6},$${i * 8 + 7},$${i * 8 + 8},$${i * 8 + 9})`).join(',');
        const args: unknown[] = [params.id];
        active.forEach((l, i) => {
          const net = Number(l.net_kgs ?? 0);
          const heads = Number(l.heads ?? 0);
          args.push(i + 1, l.item_id, l.heads ?? 0, l.gross_kgs ?? 0, l.crate_kgs ?? 0, net, heads > 0 ? net / heads : 0, l.remarks ?? null);
        });
        await client.query(
          `INSERT INTO tally_sheet_lines (tally_sheet_id, line_no, item_id, heads, gross_kgs, crate_kgs, net_kgs, avg_weight, remarks) VALUES ${vals}`,
          args,
        );
      }
      // Recompute net totals
      const netHeads = active.reduce((s, l) => s + Number(l.heads ?? 0), 0);
      const netKgs   = active.reduce((s, l) => s + Number(l.net_kgs ?? 0), 0);
      await client.query(`UPDATE tally_sheets SET net_heads=$1, net_kgs=$2 WHERE id=$3`, [netHeads, netKgs, params.id]);
    }

    await client.query('COMMIT');

    // Return updated record
    const [updated] = await query(
      `SELECT t.*, g.doc_no AS grow_cycle_no, s.name AS supplier_name, d.name AS destination_name
         FROM tally_sheets t
         LEFT JOIN grow_cycles g ON g.id = t.grow_cycle_id
         LEFT JOIN suppliers s   ON s.id = t.supplier_id
         LEFT JOIN branches d    ON d.id = t.destination_id
        WHERE t.id = $1`, [params.id]);
    const updatedLines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM tally_sheet_lines l
         JOIN items i ON i.id = l.item_id WHERE l.tally_sheet_id = $1 ORDER BY l.line_no`, [params.id]);
    return ok({ ...updated, lines: updatedLines });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message, 500);
  } finally { client.release(); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(_req); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden — admin only', 403);
  try {
    const [rec] = await query<{ id: string }>(`SELECT id FROM tally_sheets WHERE id = $1`, [params.id]);
    if (!rec) return err('Not found', 404);
    const [{ cnt }] = await query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM conversions WHERE tally_sheet_id = $1`,
      [params.id],
    );
    if (Number(cnt) > 0) return err('Cannot delete: linked conversions exist', 409);
    await query(`DELETE FROM tally_sheet_lines WHERE tally_sheet_id = $1`, [params.id]);
    await query(`DELETE FROM tally_sheets       WHERE id            = $1`, [params.id]);
    return new Response(null, { status: 204 });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
