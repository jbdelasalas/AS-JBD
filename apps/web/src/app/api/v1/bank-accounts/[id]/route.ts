export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null);
  if (!dto) return err('Invalid body', 400);

  const rows = await query(
    `UPDATE bank_accounts
        SET account_name   = COALESCE($2, account_name),
            bank_name      = COALESCE($3, bank_name),
            account_number = COALESCE($4, account_number),
            gl_account_id  = COALESCE($5, gl_account_id),
            is_active      = COALESCE($6, is_active)
      WHERE id = $1
      RETURNING *`,
    [params.id, dto.account_name ?? null, dto.bank_name ?? null,
     dto.account_number ?? null, dto.gl_account_id ?? null, dto.is_active ?? null],
  );
  if (!rows[0]) return err('Not found', 404);
  return ok(rows[0]);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  await query(`UPDATE bank_accounts SET is_active = false WHERE id = $1`, [params.id]);
  return ok({ id: params.id });
}
