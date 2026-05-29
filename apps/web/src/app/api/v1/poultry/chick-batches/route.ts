export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const status = searchParams.get('status') ?? 'available';
  try {
    const rows = await query(
      `SELECT b.*, i.name AS item_name, i.sku FROM chick_batches b JOIN items i ON i.id = b.item_id
        WHERE b.company_id = $1 AND b.status = $2 ORDER BY b.date_received DESC`,
      [companyId, status],
    );
    return ok(rows);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
