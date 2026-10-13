export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import type { PlanStop } from '@/lib/routing/types';

// Sales orders due for delivery on a date, shaped as planner stops.
// Plannable = approved or partially delivered (the statuses the SO workflow
// sets; 'open'/'partial' are kept for older rows). Orders already on a live
// trip are left out so a confirmed plan is not planned twice.
//
// Receiving hours: the order's own hours win; blank falls back to the client's
// usual hours on the customer record.

export async function GET(request: NextRequest) {
  try { await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  const date = searchParams.get('date');
  if (!companyId) return err('company_id is required', 400);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('date (YYYY-MM-DD) is required', 400);

  try {
    const rows = await query<{
      id: string; order_no: string; reference: string | null;
      customer_id: string; customer_name: string; address: string | null;
      latitude: string | null; longitude: string | null; location_confirmed: boolean;
      receiving_from: string | null; receiving_to: string | null; hours_source: 'order' | 'client' | null;
      delivery_notes: string | null;
      lines: { product: string; qty: string; uom: string }[] | null;
    }>(
      `SELECT so.id, so.order_no, so.reference,
              c.id AS customer_id, c.name AS customer_name, c.address,
              c.latitude, c.longitude, c.location_confirmed,
              CASE WHEN so.receiving_from IS NOT NULL OR so.receiving_to IS NOT NULL
                   THEN to_char(so.receiving_from, 'HH24:MI') ELSE to_char(c.receiving_from, 'HH24:MI') END AS receiving_from,
              CASE WHEN so.receiving_from IS NOT NULL OR so.receiving_to IS NOT NULL
                   THEN to_char(so.receiving_to, 'HH24:MI') ELSE to_char(c.receiving_to, 'HH24:MI') END AS receiving_to,
              CASE WHEN so.receiving_from IS NOT NULL OR so.receiving_to IS NOT NULL THEN 'order'
                   WHEN c.receiving_from IS NOT NULL OR c.receiving_to IS NOT NULL THEN 'client' END AS hours_source,
              c.delivery_notes,
              (SELECT json_agg(json_build_object(
                        'product', l.description,
                        'qty', l.quantity - l.qty_delivered,
                        'uom', i.uom) ORDER BY l.line_no)
                 FROM sales_order_lines l
                 JOIN items i ON i.id = l.item_id
                WHERE l.order_id = so.id AND l.quantity > l.qty_delivered) AS lines
         FROM sales_orders so
         JOIN customers c ON c.id = so.customer_id
        WHERE so.company_id = $1
          AND so.delivery_date = $2
          AND so.status IN ('approved', 'partially_delivered', 'open', 'partial')
          AND NOT EXISTS (
                SELECT 1 FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id
                 WHERE ts.sales_order_id = so.id AND t.status <> 'cancelled')
        ORDER BY so.order_no`,
      [companyId, date],
    );

    const stops: PlanStop[] = rows.map((r) => {
      const items = (r.lines ?? []).map((l) => {
        const qty = Number(l.qty);
        const kg = /^(kg|kgs|kilo|kilos|kilogram)$/i.test(l.uom) ? qty : null;
        return { product: l.product, qty, uom: l.uom, kg };
      });
      const hasPin = r.latitude != null && r.longitude != null;
      return {
        id: r.order_no,
        so_ref: r.order_no,
        sales_order_id: r.id,
        customer_id: r.customer_id,
        customer: r.customer_name,
        address: r.address ?? '',
        lat: hasPin ? Number(r.latitude) : null,
        lng: hasPin ? Number(r.longitude) : null,
        pin: hasPin ? (r.location_confirmed ? 'confirmed' : 'precise') : 'missing',
        kg: items.reduce((a, i) => a + (i.kg ?? 0), 0),
        items,
        window_from: r.receiving_from,
        window_to: r.receiving_to,
        hours_source: r.hours_source,
        remarks: [r.delivery_notes, r.reference].filter(Boolean).join(' · '),
        needs_reefer: true,
        small_truck_only: false,
        vehicle_id: null,
      };
    });
    return ok({ data: stops });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
