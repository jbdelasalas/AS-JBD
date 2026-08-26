export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

const NAME_MAX = 60;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const name = typeof dto.name === 'string' ? dto.name.trim() : null;
  if (name !== null && !name) return err('name cannot be empty', 400);
  if (name && name.length > NAME_MAX) return err(`name must be ${NAME_MAX} characters or fewer`, 400);

  try {
    // Promoting this row to default demotes the previous one first, so the
    // partial unique index never sees two defaults at once.
    if (dto.is_default === true) {
      const [owner] = await query<{ company_id: string }>(
        `SELECT company_id FROM dp_facilities WHERE id = $1`,
        [params.id],
      );
      if (!owner) return err('Not found', 404);
      await query(
        `UPDATE dp_facilities SET is_default = false WHERE company_id = $1 AND is_default AND id <> $2`,
        [owner.company_id, params.id],
      );
    }

    const [row] = await query(
      `UPDATE dp_facilities
          SET name       = COALESCE($2, name),
              address    = COALESCE($3, address),
              is_default = COALESCE($4, is_default),
              is_active  = COALESCE($5, is_active),
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, address, is_default, is_active`,
      [
        params.id,
        name,
        typeof dto.address === 'string' ? dto.address.trim() : null,
        typeof dto.is_default === 'boolean' ? dto.is_default : null,
        typeof dto.is_active === 'boolean' ? dto.is_active : null,
      ],
    );
    if (!row) return err('Not found', 404);
    return ok(row);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (/unique|duplicate/i.test(msg)) return err('Another facility already uses that name', 409);
    return err(msg, 500);
  }
}

/**
 * Deactivates rather than deletes: issued lots reference the facility, and a
 * traceability record must keep pointing at the plant that printed it.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  try {
    const [row] = await query(
      `UPDATE dp_facilities
          SET is_active = false, is_default = false, updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [params.id],
    );
    if (!row) return err('Not found', 404);
    return ok({ id: row.id, deactivated: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
