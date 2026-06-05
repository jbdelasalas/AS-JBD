export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const [branch] = await query<Record<string, unknown>>(
      `SELECT b.id, b.company_id, b.code, b.name, b.address,
              b.bir_atp_number, b.bir_atp_valid_from, b.bir_atp_valid_to,
              b.ptu_number, b.man_number, b.manager_user_id, b.is_active, b.created_at,
              bs.signatory_name, bs.signatory_tin, bs.signatory_position
         FROM branches b
         LEFT JOIN bir_setup bs ON bs.branch_id = b.id
        WHERE b.id = $1`,
      [params.id]
    );
    if (!branch) return err('Not found', 404);

    return ok(branch);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const body = await req.json();
    const allowed = [
      'name', 'address', 'is_active', 'manager_user_id',
      'bir_atp_number', 'bir_atp_valid_from', 'bir_atp_valid_to',
      'ptu_number', 'man_number',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of allowed) {
      if (col in body) {
        fields.push(`${col} = $${idx++}`);
        values.push(body[col]);
      }
    }
    if (fields.length === 0) return err('No fields to update', 400);

    fields.push(`updated_by = $${idx++}`);
    values.push(auth.userId, params.id);

    const [updated] = await query<{ id: string }>(
      `UPDATE branches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
