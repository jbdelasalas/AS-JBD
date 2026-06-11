export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Admin: manage a customer's contracted prices.
// GET /portal/price-list?company_id=..&customer_id=..
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const customerId = searchParams.get('customer_id');
  if (!companyId || !customerId) return err('company_id and customer_id are required', 400);

  const rows = await query<Record<string, unknown>>(
    `SELECT cpl.id, cpl.item_id, i.sku, i.name AS item_name, i.uom,
            i.selling_price AS base_price, cpl.custom_price, cpl.effective_date, cpl.notes
       FROM customer_price_list cpl
       JOIN items i ON i.id = cpl.item_id
      WHERE cpl.company_id = $1 AND cpl.customer_id = $2
      ORDER BY i.name ASC`,
    [companyId, customerId],
  );
  return ok({
    data: rows.map((r) => ({
      ...r,
      base_price: Number(r.base_price),
      custom_price: Number(r.custom_price),
    })),
  });
}

// POST /portal/price-list — upsert a contracted price for (customer, item)
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { company_id, customer_id, item_id, custom_price } = dto as Record<string, string>;
  if (!company_id || !customer_id || !item_id || custom_price == null)
    return err('company_id, customer_id, item_id and custom_price are required', 400);

  const rows = await query<Record<string, unknown>>(
    `INSERT INTO customer_price_list (company_id, customer_id, item_id, custom_price, effective_date, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (customer_id, item_id) DO UPDATE
       SET custom_price = EXCLUDED.custom_price,
           effective_date = EXCLUDED.effective_date,
           notes = EXCLUDED.notes,
           updated_at = now()
     RETURNING *`,
    [company_id, customer_id, item_id, custom_price, dto.effective_date ?? null, dto.notes ?? null],
  );

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1,$2,'upsert','customer_price',$3,$4)`,
    [auth.userId, company_id, rows[0].id, JSON.stringify(rows[0])],
  ).catch(() => {});

  return ok({ ...rows[0], custom_price: Number(rows[0].custom_price) }, 201);
}

// DELETE /portal/price-list?id=..
export async function DELETE(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('id is required', 400);

  const rows = await query<{ company_id: string }>(
    `DELETE FROM customer_price_list WHERE id = $1 RETURNING company_id`,
    [id],
  );
  if (!rows[0]) return err('Not found', 404);

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
     VALUES ($1,$2,'delete','customer_price',$3)`,
    [auth.userId, rows[0].company_id, id],
  ).catch(() => {});

  return ok({ deleted: true });
}
