export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

const BIN_TYPES = ['receiving', 'storage', 'picking', 'staging', 'shipping'];

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `b.company_id = $1`;
  const warehouseId = searchParams.get('warehouse_id');
  if (warehouseId) { params.push(warehouseId); where += ` AND b.warehouse_id = $${params.length}`; }
  if (searchParams.get('active') === 'true') where += ` AND b.is_active = true`;

  const rows = await query(
    `SELECT b.id, b.code, b.zone, b.bin_type, b.is_active, b.warehouse_id,
            w.name AS warehouse_name, b.created_at
       FROM bins b
       JOIN warehouses w ON w.id = b.warehouse_id
      WHERE ${where}
      ORDER BY w.name, b.code`,
    params,
  );
  return ok(rows);
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const companyId = dto.company_id as string;
  const warehouseId = dto.warehouse_id as string;
  const code = (dto.code as string)?.trim();
  if (!companyId || !warehouseId || !code) return err('company_id, warehouse_id, code are required', 400);

  const binType = (dto.bin_type as string) ?? 'storage';
  if (!BIN_TYPES.includes(binType)) return err(`bin_type must be one of ${BIN_TYPES.join(', ')}`, 400);

  try {
    const [bin] = await query(
      `INSERT INTO bins (company_id, warehouse_id, code, zone, bin_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [companyId, warehouseId, code.toUpperCase(), (dto.zone as string)?.trim() || null, binType],
    );
    return ok(bin, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('uq') || msg.includes('duplicate') || msg.includes('bins_warehouse_id_code_key'))
      return err(`A bin with code ${code} already exists in this warehouse`, 409);
    return err(msg ?? 'Failed to create bin', 500);
  }
}
