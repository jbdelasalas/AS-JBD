export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { ensureLabel } from '@/lib/scan-codes';

// Pallets group storage boxes so one scan relocates the whole stack.
// Creating a pallet immediately issues its QR label — a pallet you can't scan
// would be useless on the floor.

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
    `SELECT p.id, p.pallet_no, p.status, p.notes, p.created_at,
            p.bin_id, b.code AS bin_code,
            p.warehouse_id, w.name AS warehouse_name,
            q.code AS qr_code,
            (SELECT COUNT(*)::int FROM dp_storage_boxes x
              WHERE x.pallet_id = p.id AND x.status = 'in_storage') AS box_count,
            (SELECT COALESCE(SUM(x.net_weight_kg), 0) FROM dp_storage_boxes x
              WHERE x.pallet_id = p.id AND x.status = 'in_storage') AS net_weight_kg
       FROM pallets p
       LEFT JOIN bins       b ON b.id = p.bin_id
       LEFT JOIN warehouses w ON w.id = p.warehouse_id
       LEFT JOIN qr_labels  q ON q.entity_type = 'pallet' AND q.entity_id = p.id AND q.is_active
      WHERE ${where}
      ORDER BY p.created_at DESC`,
    params,
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Auto-number when the floor doesn't supply one: PLT-00001, PLT-00002, …
    let palletNo = ((dto.pallet_no as string) ?? '').trim().toUpperCase();
    if (!palletNo) {
      const n = (await client.query(
        `SELECT COUNT(*)::int AS c FROM pallets WHERE company_id = $1`, [companyId],
      )).rows[0].c as number;
      palletNo = `PLT-${String(n + 1).padStart(5, '0')}`;
    }

    const inserted = (await client.query(
      `INSERT INTO pallets (company_id, pallet_no, warehouse_id, bin_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, pallet_no, status`,
      [companyId, palletNo,
       (dto.warehouse_id as string) || null, (dto.bin_id as string) || null,
       (dto.notes as string) || null, auth.userId],
    )).rows[0];

    const code = await ensureLabel(client, companyId, 'pallet', String(inserted.id), auth.userId);
    await client.query('COMMIT');
    return ok({ ...inserted, qr_code: code }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = (e as Error).message ?? '';
    if (msg.includes('duplicate') || msg.includes('pallets_company_id_pallet_no_key'))
      return err('A pallet with that number already exists', 409);
    return err(msg || 'Failed to create pallet', 500);
  } finally {
    client.release();
  }
}
