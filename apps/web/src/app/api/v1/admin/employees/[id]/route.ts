export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try { await requireAuth(req); } catch (e) { return e as Response; }
  try {
    const [emp] = await query(
      `SELECT e.*, d.name AS department_name, u.email AS user_email, u.full_name AS user_full_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.id = $1`,
      [params.id],
    );
    if (!emp) return err('Not found', 404);
    return ok(emp);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try { await requireAuth(req); } catch (e) { return e as Response; }
  try {
    const body = await req.json() as Record<string, unknown>;
    const allowed = [
      'full_name','email','phone','department_id','position',
      'employment_type','hire_date','end_date','user_id','is_active','notes',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const col of allowed) {
      if (col in body) { fields.push(`${col} = $${idx++}`); values.push(body[col]); }
    }
    if (fields.length === 0) return err('No fields to update', 400);
    values.push(params.id);
    const [updated] = await query<{ id: string }>(
      `UPDATE employees SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values,
    );
    if (!updated) return err('Not found', 404);
    return ok(updated);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
