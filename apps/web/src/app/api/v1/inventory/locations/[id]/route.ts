export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT w.id, w.code, w.name, w.address, w.is_active,
            COUNT(DISTINCT sb.item_id) AS item_count
       FROM warehouses w
       LEFT JOIN stock_balances sb ON sb.warehouse_id = w.id AND sb.qty_on_hand > 0
      WHERE w.id = $1
      GROUP BY w.id`,
    [params.id],
  );
  if (!rows[0]) return err('Location not found', 404);

  const r = rows[0] as Record<string, unknown>;
  return ok({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    address: r.address ? String(r.address) : null,
    is_active: Boolean(r.is_active),
    item_count: Number(r.item_count ?? 0),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  try {
    const rows = await query(
      `UPDATE warehouses
          SET code = COALESCE($2, code),
              name = COALESCE($3, name),
              address = $4,
              is_active = COALESCE($5, is_active)
        WHERE id = $1
        RETURNING *`,
      [params.id, dto.code ? String(dto.code).toUpperCase() : null, dto.name ?? null, dto.address ?? null, dto.is_active ?? null],
    );
    if (!rows[0]) return err('Location not found', 404);
    const r = rows[0] as Record<string, unknown>;
    return ok({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      address: r.address ? String(r.address) : null,
      is_active: Boolean(r.is_active),
    });
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to update location', 500);
  }
}
