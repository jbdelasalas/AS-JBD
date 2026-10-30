export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Active trucks from the vehicles master, with their default crew, for the
// live-bird booking form. Plain list — the logistics fleet route needs the
// trip-planning permission, which plant staff don't have.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT id, plate_no, description, default_driver, default_helper
       FROM vehicles
      WHERE company_id = $1 AND is_active = true
      ORDER BY plate_no`,
    [companyId],
  );
  return ok({ data: rows });
}
