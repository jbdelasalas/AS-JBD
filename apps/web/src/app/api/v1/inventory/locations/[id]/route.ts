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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const existing = await query(
    `SELECT id, company_id FROM warehouses WHERE id = $1 LIMIT 1`,
    [params.id],
  );
  if (!existing[0]) return err('Location not found', 404);
  const wh = existing[0] as Record<string, unknown>;

  // Guard: refuse if the location holds stock or has any movement history.
  // (stock_balances cascade-delete, so the FK error alone would not catch
  // a location that has on-hand stock — check explicitly.)
  const blocking = await query<{ on_hand: string; movements: string }>(
    `SELECT
        (SELECT COUNT(*) FROM stock_balances WHERE warehouse_id = $1 AND qty_on_hand <> 0) AS on_hand,
        (SELECT COUNT(*) FROM stock_movements WHERE warehouse_id = $1) AS movements`,
    [params.id],
  );
  const b = blocking[0];
  if (b && (Number(b.on_hand) > 0 || Number(b.movements) > 0)) {
    return err('This location has stock or movement history and cannot be deleted. Deactivate it instead.', 409);
  }

  try {
    await query(`DELETE FROM warehouses WHERE id = $1`, [params.id]);
  } catch (e: unknown) {
    // Foreign-key violation: location is referenced by other transactions.
    if ((e as { code?: string }).code === '23503') {
      return err('This location has linked transactions and cannot be deleted. Deactivate it instead.', 409);
    }
    return err((e as Error).message ?? 'Failed to delete location', 500);
  }

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.userId, wh.company_id, 'delete', 'location', params.id],
  ).catch(() => {/* non-fatal */});

  return ok({ id: params.id, deleted: true });
}
