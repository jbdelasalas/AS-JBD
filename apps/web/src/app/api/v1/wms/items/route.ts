export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Items with their WMS tracking_mode, for the Lots & Serials screen.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT id, sku, name, uom, COALESCE(tracking_mode,'none') AS tracking_mode
       FROM items WHERE company_id = $1 AND is_active = true ORDER BY sku`,
    [companyId],
  );
  return ok(rows);
}

// Set an item's tracking mode (none | lot | serial).
export async function PATCH(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }
  const itemId = dto.item_id as string;
  const mode = dto.tracking_mode as string;
  if (!itemId || !['none', 'lot', 'serial'].includes(mode)) return err('item_id and a valid tracking_mode are required', 400);

  const [item] = await query(`UPDATE items SET tracking_mode = $1 WHERE id = $2 RETURNING id, sku, tracking_mode`, [mode, itemId]);
  if (!item) return err('Item not found', 404);
  return ok(item);
}
