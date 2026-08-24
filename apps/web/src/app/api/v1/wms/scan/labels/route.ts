export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { ensureLabel, type ScanEntity } from '@/lib/scan-codes';

const ENTITIES: ScanEntity[] = ['bin', 'box', 'pallet'];

// The label registry: what exists to be printed, and issuing labels for rows
// that don't have one yet (e.g. bins created before this feature shipped).

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const entity = searchParams.get('entity_type') as ScanEntity | null;
  if (entity && !ENTITIES.includes(entity)) return err(`entity_type must be one of ${ENTITIES.join(', ')}`, 400);

  // One query per kind, since the human-readable label lives in a different
  // table for each. Returns a uniform shape so the print page can stay generic.
  const out: Record<string, unknown>[] = [];

  if (!entity || entity === 'bin') {
    const bins = await query(
      `SELECT q.code, 'bin' AS entity_type, b.id AS entity_id,
              b.code AS title, w.name AS subtitle,
              COALESCE(b.zone, b.bin_type) AS detail, q.printed_at
         FROM qr_labels q
         JOIN bins b ON b.id = q.entity_id
         JOIN warehouses w ON w.id = b.warehouse_id
        WHERE q.company_id = $1 AND q.entity_type = 'bin' AND q.is_active
        ORDER BY w.name, b.code`,
      [companyId],
    );
    out.push(...bins);
  }

  if (!entity || entity === 'pallet') {
    const pallets = await query(
      `SELECT q.code, 'pallet' AS entity_type, p.id AS entity_id,
              p.pallet_no AS title,
              COALESCE(b.code, 'unassigned') AS subtitle,
              p.status AS detail, q.printed_at
         FROM qr_labels q
         JOIN pallets p ON p.id = q.entity_id
         LEFT JOIN bins b ON b.id = p.bin_id
        WHERE q.company_id = $1 AND q.entity_type = 'pallet' AND q.is_active
        ORDER BY p.pallet_no`,
      [companyId],
    );
    out.push(...pallets);
  }

  if (!entity || entity === 'box') {
    const boxes = await query(
      `SELECT q.code, 'box' AS entity_type, x.id AS entity_id,
              x.product AS title,
              COALESCE(jo.batch_no, '') AS subtitle,
              x.net_weight_kg::text || ' kg' AS detail, q.printed_at
         FROM qr_labels q
         JOIN dp_storage_boxes x ON x.id = q.entity_id
         LEFT JOIN dp_job_orders jo ON jo.id = x.job_order_id
        WHERE q.company_id = $1 AND q.entity_type = 'box' AND q.is_active
          AND x.status = 'in_storage'
        ORDER BY x.time_in DESC
        LIMIT 500`,
      [companyId],
    );
    out.push(...boxes);
  }

  return ok({ data: out });
}

/**
 * Issue labels. Either for one entity (`entity_type` + `entity_id`), or in bulk
 * for everything of a kind that is still unlabelled (`entity_type` + `all:true`).
 */
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const entity = dto.entity_type as ScanEntity;
  if (!companyId) return err('company_id is required', 400);
  if (!ENTITIES.includes(entity)) return err(`entity_type must be one of ${ENTITIES.join(', ')}`, 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    if (dto.all === true) {
      const table = entity === 'bin' ? 'bins' : entity === 'pallet' ? 'pallets' : 'dp_storage_boxes';
      const rows = (await client.query(
        `SELECT t.id FROM ${table} t
          WHERE t.company_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM qr_labels q
               WHERE q.entity_type = $2 AND q.entity_id = t.id
            )`,
        [companyId, entity],
      )).rows;

      for (const r of rows) await ensureLabel(client, companyId, entity, String(r.id), auth.userId);
      await client.query('COMMIT');
      return ok({ issued: rows.length, entity_type: entity });
    }

    const entityId = dto.entity_id as string;
    if (!entityId) { await client.query('ROLLBACK'); return err('entity_id is required (or pass all:true)', 400); }
    const code = await ensureLabel(client, companyId, entity, entityId, auth.userId);
    await client.query('COMMIT');
    return ok({ code, entity_type: entity, entity_id: entityId }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to issue label', 500);
  } finally {
    client.release();
  }
}

/** Mark labels as printed, so the print page can show what still needs a sticker. */
export async function PATCH(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  const codes = dto.codes as string[];
  if (!companyId) return err('company_id is required', 400);
  if (!Array.isArray(codes) || !codes.length) return err('codes must be a non-empty array', 400);

  await query(
    `UPDATE qr_labels SET printed_at = now() WHERE company_id = $1 AND code = ANY($2::varchar[])`,
    [companyId, codes],
  );
  return ok({ printed: codes.length });
}
