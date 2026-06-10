export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const [branch] = await query<Record<string, unknown>>(
      `SELECT b.id, b.company_id, b.code, b.name, b.address, b.is_active, b.created_at
         FROM branches b
        WHERE b.id = $1`,
      [params.id]
    );
    if (!branch) return err('Not found', 404);

    return ok(branch);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const body = await req.json();
    const allowed = ['name', 'address', 'is_active'];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of allowed) {
      if (col in body) {
        fields.push(`${col} = $${idx++}`);
        values.push(body[col]);
      }
    }
    if (fields.length === 0) return err('No fields to update', 400);

    values.push(params.id);

    const [updated] = await query<{ id: string }>(
      `UPDATE branches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

  try {
    const [branch] = await query<{ id: string; company_id: string }>(
      `SELECT id, company_id FROM branches WHERE id = $1`,
      [params.id],
    );
    if (!branch) return err('Location not found', 404);

    // A location may have a linked warehouse. Refuse if that warehouse holds
    // stock or has movement history (stock_balances cascade-delete, so the FK
    // error alone would not catch a warehouse that still holds stock).
    const [blocking] = await query<{ on_hand: string; movements: string }>(
      `SELECT
          (SELECT COUNT(*) FROM stock_balances sb
             JOIN warehouses w ON w.id = sb.warehouse_id
            WHERE w.branch_id = $1 AND sb.qty_on_hand <> 0) AS on_hand,
          (SELECT COUNT(*) FROM stock_movements sm
             JOIN warehouses w ON w.id = sm.warehouse_id
            WHERE w.branch_id = $1) AS movements`,
      [params.id],
    );
    if (blocking && (Number(blocking.on_hand) > 0 || Number(blocking.movements) > 0)) {
      return err('This location has stock or movement history and cannot be deleted. Deactivate it instead.', 409);
    }

    // Remove the linked warehouse(s) first (empty balances cascade away),
    // then the branch itself.
    await query(`DELETE FROM warehouses WHERE branch_id = $1`, [params.id]);
    await query(`DELETE FROM branches WHERE id = $1`, [params.id]);

    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, branch.company_id, 'delete', 'location', params.id],
    ).catch(() => {/* non-fatal */});

    return ok({ id: params.id, deleted: true });
  } catch (e: unknown) {
    // Foreign-key violation: branch/warehouse is referenced by transactions.
    if ((e as { code?: string }).code === '23503') {
      return err('This location has linked transactions and cannot be deleted. Deactivate it instead.', 409);
    }
    return err((e as Error).message ?? 'Failed to delete location', 500);
  }
}
