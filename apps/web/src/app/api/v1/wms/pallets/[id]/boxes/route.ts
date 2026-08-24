export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { normalizeScan, entityFromCode, isValidScanCode } from '@/lib/scan-codes';

// Load a scanned box onto this pallet (POST) or take it off (DELETE).
// Building a pallet is a stacking operation, not an inventory movement — the
// box keeps its bin, so no stock is posted here. Moving the pallet afterwards
// is what relocates the stock, via /wms/scan/move.

async function resolveBox(code: string, companyId: string) {
  const [row] = await query<{ entity_id: string; company_id: string }>(
    `SELECT entity_id, company_id FROM qr_labels
      WHERE code = $1 AND entity_type = 'box' AND is_active`,
    [code],
  );
  if (!row) return { error: err(`Box label "${code}" not found`, 404) };
  if (row.company_id !== companyId) return { error: err('Label belongs to another company', 403) };
  return { boxId: row.entity_id };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const code = normalizeScan((dto.code as string) ?? '');
  if (!code) return err('code is required', 400);
  if (!isValidScanCode(code) || entityFromCode(code) !== 'box') return err('Scan a box label to load a pallet', 422);

  const [pallet] = await query<{ id: string; status: string }>(
    `SELECT id, status FROM pallets WHERE id = $1 AND company_id = $2`,
    [params.id, companyId],
  );
  if (!pallet) return err('Pallet not found', 404);
  if (pallet.status !== 'open') return err(`Pallet is ${pallet.status}; only open pallets accept boxes`, 409);

  const { boxId, error } = await resolveBox(code, companyId);
  if (error) return error;

  const [box] = await query<{ id: string; status: string; pallet_id: string | null }>(
    `SELECT id, status, pallet_id FROM dp_storage_boxes WHERE id = $1`,
    [boxId],
  );
  if (!box) return err('Box no longer exists', 404);
  if (box.status !== 'in_storage') return err(`Box is ${box.status} and cannot be palletised`, 409);
  if (box.pallet_id && box.pallet_id !== params.id) return err('Box is already on another pallet', 409);

  await query(`UPDATE dp_storage_boxes SET pallet_id = $1 WHERE id = $2`, [params.id, boxId]);
  return ok({ pallet_id: params.id, box_id: boxId, code });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const code = normalizeScan((dto.code as string) ?? '');
  if (!code || entityFromCode(code) !== 'box') return err('Scan a box label to unload it', 422);

  const { boxId, error } = await resolveBox(code, companyId);
  if (error) return error;

  const res = await query(
    `UPDATE dp_storage_boxes SET pallet_id = NULL
      WHERE id = $1 AND pallet_id = $2 RETURNING id`,
    [boxId, params.id],
  );
  if (!res.length) return err('That box is not on this pallet', 404);
  return ok({ pallet_id: params.id, box_id: boxId, removed: true });
}
