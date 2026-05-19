export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    address: r.address ? String(r.address) : null,
    is_active: Boolean(r.is_active),
    item_count: Number(r.item_count ?? 0),
  };
}

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT w.id, w.code, w.name, w.address, w.is_active,
            COUNT(DISTINCT sb.item_id) AS item_count
       FROM warehouses w
       LEFT JOIN stock_balances sb ON sb.warehouse_id = w.id AND sb.qty_on_hand > 0
      WHERE w.company_id = $1
      GROUP BY w.id
      ORDER BY w.name`,
    [companyId],
  );

  return ok(rows.map((r) => mapRow(r as Record<string, unknown>)));
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code || !dto.name) return err('code and name are required', 400);

  try {
    const rows = await query(
      `INSERT INTO warehouses (company_id, code, name, address, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, String(dto.code).toUpperCase(), dto.name, dto.address ?? null, dto.is_active ?? true],
    );
    return ok(mapRow(rows[0] as Record<string, unknown>), 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to create location', 500);
  }
}
