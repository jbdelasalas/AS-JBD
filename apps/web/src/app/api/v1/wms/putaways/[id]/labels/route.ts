export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// QR labels for one put-away: a sticker per pack (box) it put into storage, and
// one per bin it used. Labels that don't exist yet are issued here (codes are
// derived from the row id, so re-issuing is harmless). Packs only exist once
// the put-away is posted; before that only the bin labels can be printed.
// POST because it may issue labels; the response is the print rows.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [pa] } = await client.query(`SELECT id, company_id, status FROM putaways WHERE id = $1`, [params.id]);
    if (!pa) { await client.query('ROLLBACK'); return err('Put-away not found', 404); }

    const { rows: boxes } = await client.query(
      `SELECT DISTINCT ON (x.id) x.id FROM putaway_lines pl
         JOIN dp_storage_boxes x ON x.dp_output_id = pl.dp_output_id
        WHERE pl.putaway_id = $1 AND x.status = 'in_storage'`, [params.id]);
    const { rows: bins } = await client.query(
      `SELECT DISTINCT bin_id AS id FROM putaway_lines WHERE putaway_id = $1`, [params.id]);

    const issue = (entity: 'box' | 'bin', ids: string[]) => client.query(
      `INSERT INTO qr_labels (company_id, code, entity_type, entity_id, created_by)
       SELECT $1, $2 || '-' || replace(x.id::text, '-', ''), $3, x.id, $4 FROM unnest($5::uuid[]) AS x(id)
       ON CONFLICT (code) DO NOTHING`,
      [pa.company_id, entity.toUpperCase(), entity, auth.userId, ids]);
    await issue('box', boxes.map((b) => String(b.id)));
    await issue('bin', bins.map((b) => String(b.id)));

    // Same shape as /wms/scan/labels, so the sticker component is shared.
    const { rows: packLabels } = await client.query(
      `SELECT q.code, 'box' AS entity_type, x.id AS entity_id, x.dp_output_id,
              x.product || COALESCE(' #' || po.line_no, '') AS title,
              concat_ws(' · ', jo.batch_no, b.code) AS subtitle,
              x.net_weight_kg::text || ' kg' || COALESCE(' · ' || NULLIF(po.head_count, 0) || ' hd', '') AS detail,
              q.printed_at
         FROM dp_storage_boxes x
         JOIN qr_labels q ON q.entity_type = 'box' AND q.entity_id = x.id AND q.is_active
         LEFT JOIN dp_processed_output po ON po.id = x.dp_output_id
         LEFT JOIN dp_job_orders jo ON jo.id = x.job_order_id
         LEFT JOIN bins b ON b.id = x.bin_id
        WHERE x.id = ANY($1::uuid[])
        ORDER BY po.line_no NULLS LAST, x.time_in`,
      [boxes.map((b) => String(b.id))]);
    const { rows: binLabels } = await client.query(
      `SELECT q.code, 'bin' AS entity_type, b.id AS entity_id, b.id AS bin_id, b.code AS title, w.name AS subtitle,
              COALESCE(b.zone, b.bin_type) AS detail, q.printed_at
         FROM bins b
         JOIN warehouses w ON w.id = b.warehouse_id
         JOIN qr_labels q ON q.entity_type = 'bin' AND q.entity_id = b.id AND q.is_active
        WHERE b.id = ANY($1::uuid[])
        ORDER BY b.code`,
      [bins.map((b) => String(b.id))]);

    const { rows: [co] } = await client.query(`SELECT logo FROM companies WHERE id = $1`, [pa.company_id]);
    await client.query('COMMIT');
    return ok({ status: pa.status, logo: co?.logo ?? null, packs: packLabels, bins: binLabels });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to load labels', 500);
  } finally {
    client.release();
  }
}
