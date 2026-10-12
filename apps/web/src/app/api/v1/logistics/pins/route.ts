export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { remember } from '@/lib/routing/geocode';

// A pin a person placed by hand. It is the best location we will ever have, so
// it is written everywhere it applies: the address cache (so pasted orders with
// the same address land on it too), and the customer or warehouse record.

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requirePermission>>;
  try { auth = await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  let dto: { company_id?: string; address?: string; lat?: number; lng?: number; customer_id?: string | null; warehouse_id?: string | null };
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const { company_id: companyId, address } = dto;
  const lat = Number(dto.lat), lng = Number(dto.lng);
  if (!companyId) return err('company_id is required', 400);
  // Rough box around the Philippines — catches swapped lat/lng and stray clicks.
  if (!(lat >= 4 && lat <= 22 && lng >= 116 && lng <= 127.5)) return err('Pin must be inside the Philippines', 400);

  try {
    if (address?.trim()) {
      await remember(companyId, address, { lat, lng, formatted: null, precise: true }, 'manual');
    }
    if (dto.customer_id) {
      await query(
        `UPDATE customers SET latitude = $1, longitude = $2, location_confirmed = true, updated_at = now()
          WHERE id = $3 AND company_id = $4`,
        [lat, lng, dto.customer_id, companyId],
      );
    }
    if (dto.warehouse_id) {
      await query(
        `UPDATE warehouses SET latitude = $1, longitude = $2 WHERE id = $3 AND company_id = $4`,
        [lat, lng, dto.warehouse_id, companyId],
      );
    }
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'update',$3,$4)`,
      [auth.userId, companyId, dto.warehouse_id ? 'warehouse_location' : 'customer_location', dto.warehouse_id ?? dto.customer_id ?? null],
    ).catch(() => {});
    return ok({ lat, lng });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
