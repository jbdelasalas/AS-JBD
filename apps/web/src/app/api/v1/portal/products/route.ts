export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';
import { resolvePortalCustomer } from '@/lib/portal-helpers';

// Products this customer can order, priced at their contracted price
// (customer_price_list) falling back to the item's base selling_price.
export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const res = await resolvePortalCustomer(auth);
  if ('response' in res) return res.response;
  const { customer } = res;

  const rows = await query<Record<string, unknown>>(
    `SELECT i.id, i.sku, i.name, i.uom, i.selling_price,
            cpl.custom_price,
            COALESCE(cpl.custom_price, i.selling_price) AS price
       FROM items i
       LEFT JOIN customer_price_list cpl
         ON cpl.item_id = i.id AND cpl.customer_id = $2
      WHERE i.company_id = $1
        AND i.is_active = true
        AND i.item_type = 'stock'
      ORDER BY i.name ASC`,
    [customer.company_id, customer.id],
  );

  return ok({
    data: rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      uom: r.uom,
      price: Number(r.price ?? 0),
      is_contracted: r.custom_price != null,
    })),
  });
}
