export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { normalizeScan, entityFromCode } from '@/lib/scan-codes';

// One scan while picking. The picker scans the bin first, then each pack taken
// from it:
//   - a bin label sets the bin being picked from (it must be a bin on this list)
//     and confirms any loose-stock lines in it;
//   - a pack label must be a pack on this list, sitting in the bin just scanned.
// Anything else is refused with a message saying what is wrong, so a wrong item
// or a wrong bin is caught at the shelf. Nothing moves until the pick is
// confirmed and shipped.

const uuidOf = (code: string) => {
  const h = code.slice(4);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const body = await request.json().catch(() => ({}));
  const code = normalizeScan(String(body.code ?? ''));
  const currentBin = body.bin_id ? String(body.bin_id) : null;
  const entity = entityFromCode(code);
  if (!entity) return err(`"${code}" is not a bin or pack label`, 422);
  const entityId = uuidOf(code);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const fail = async (msg: string, status = 409) => { await client.query('ROLLBACK'); return err(msg, status); };

    const { rows: [pl] } = await client.query(`SELECT id, status, warehouse_id FROM pick_lists WHERE id = $1 FOR UPDATE`, [params.id]);
    if (!pl) return fail('Pick list not found', 404);
    if (!['draft', 'picking'].includes(String(pl.status))) return fail(`Pick list is already ${pl.status}`, 400);

    if (entity === 'bin') {
      const { rows: [bin] } = await client.query(`SELECT id, code, warehouse_id FROM bins WHERE id = $1`, [entityId]);
      if (!bin) return fail('Unknown bin label', 404);
      if (String(bin.warehouse_id) !== String(pl.warehouse_id)) return fail(`Wrong warehouse — bin ${bin.code} is not in this pick list's warehouse`);
      const { rows: inBin } = await client.query(
        `SELECT id, box_id FROM pick_list_lines pl
          WHERE pick_id = $1 AND (bin_id = $2 OR box_id IN (SELECT id FROM dp_storage_boxes WHERE bin_id = $2))`,
        [params.id, bin.id]);
      if (!inBin.length) return fail(`Wrong bin — nothing on this pick list is in ${bin.code}`);
      // Loose-stock lines are confirmed by the bin scan alone.
      await client.query(
        `UPDATE pick_list_lines SET bin_scanned_at = now(), scanned_by = $3
          WHERE pick_id = $1 AND bin_id = $2 AND box_id IS NULL`,
        [params.id, bin.id, auth.userId]);
      await client.query(`UPDATE pick_lists SET status = 'picking', updated_at = now() WHERE id = $1 AND status = 'draft'`, [params.id]);
      await client.query('COMMIT');
      return ok({ kind: 'bin', bin_id: bin.id, bin_code: bin.code, message: `Bin ${bin.code} — scan the packs` });
    }

    if (entity !== 'box') return fail('Scan a bin label or a pack label, not a pallet', 422);

    const { rows: [box] } = await client.query(
      `SELECT x.id, x.product, x.bin_id, b.code AS bin_code, x.status, po.line_no AS pack_no
         FROM dp_storage_boxes x
         LEFT JOIN bins b ON b.id = x.bin_id
         LEFT JOIN dp_processed_output po ON po.id = x.dp_output_id
        WHERE x.id = $1`, [entityId]);
    if (!box) return fail('Unknown pack label', 404);
    const packName = `${box.product}${box.pack_no ? ` #${box.pack_no}` : ''}`;
    const { rows: [line] } = await client.query(
      `SELECT id, box_scanned_at FROM pick_list_lines WHERE pick_id = $1 AND box_id = $2`, [params.id, box.id]);
    if (!line) return fail(`Wrong pack — ${packName} (bin ${box.bin_code ?? '?'}) is not on this pick list. Put it back.`);
    if (box.status !== 'in_storage') return fail(`${packName} is already ${box.status}`);
    if (!currentBin) return fail(`Scan the bin label first (${packName} should be in ${box.bin_code ?? '?'})`, 400);
    if (String(box.bin_id) !== currentBin) return fail(`Wrong bin — ${packName} is recorded in ${box.bin_code ?? '?'}, not the bin you scanned`);
    if (line.box_scanned_at) return fail(`${packName} was already scanned`, 409);

    // The pack may have been moved since the list was made — follow the box.
    await client.query(
      `UPDATE pick_list_lines SET box_scanned_at = now(), bin_scanned_at = COALESCE(bin_scanned_at, now()), scanned_by = $2, bin_id = $3
        WHERE id = $1`,
      [line.id, auth.userId, box.bin_id]);
    await client.query(`UPDATE pick_lists SET status = 'picking', updated_at = now() WHERE id = $1 AND status = 'draft'`, [params.id]);
    await client.query('COMMIT');
    return ok({ kind: 'box', line_id: line.id, message: `✓ ${packName}` });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Scan failed', 500);
  } finally {
    client.release();
  }
}
