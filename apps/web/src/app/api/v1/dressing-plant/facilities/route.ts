export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Facility / brand names printed on traceability labels. Managed reference data
// rather than a free-text field, so one plant cannot appear under three
// spellings across stations. Edited in Administration -> Master Data.

const NAME_MAX = 60; // what fits a label; the page enforces the same limit

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  // The label page only wants usable entries; the admin screen wants them all.
  const includeInactive = searchParams.get('include_inactive') === 'true';

  try {
    const rows = await query(
      `SELECT id, name, address, is_default, is_active
         FROM dp_facilities
        WHERE company_id = $1 AND ($2 OR is_active = true)
        ORDER BY is_default DESC, name`,
      [companyId, includeInactive],
    );
    return ok({ data: rows });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const name = typeof dto.name === 'string' ? dto.name.trim() : '';
  if (!name) return err('name is required', 400);
  if (name.length > NAME_MAX) return err(`name must be ${NAME_MAX} characters or fewer`, 400);

  const makeDefault = dto.is_default === true;

  try {
    // Clearing the old default first keeps the partial unique index satisfied.
    if (makeDefault) {
      await query(`UPDATE dp_facilities SET is_default = false WHERE company_id = $1 AND is_default`, [companyId]);
    }
    const [row] = await query(
      `INSERT INTO dp_facilities (company_id, name, address, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, address, is_default, is_active`,
      [companyId, name, (dto.address as string)?.trim() || null, makeDefault],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (/unique|duplicate/i.test(msg)) return err(`Facility "${name}" already exists`, 409);
    return err(msg, 500);
  }
}
