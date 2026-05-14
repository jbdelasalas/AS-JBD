import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const [company] = await query<Record<string, unknown>>(
      `SELECT id, code, name, trade_name, tin, vat_status, rdo_code, business_style,
              registered_address, registration_date, books_start_date,
              accounting_method, fiscal_year_start_month, is_active, created_at, updated_at
         FROM companies WHERE id = $1`,
      [params.id]
    );
    if (!company) return err('Not found', 404);

    const branches = await query<{ id: string; code: string; name: string; is_active: boolean }>(
      `SELECT id, code, name, is_active FROM branches WHERE company_id = $1 ORDER BY code`,
      [params.id]
    );

    return ok({ ...company, branches });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const allowed = [
      'name', 'trade_name', 'tin', 'vat_status', 'rdo_code', 'business_style',
      'registered_address', 'registration_date', 'books_start_date',
      'accounting_method', 'fiscal_year_start_month', 'is_active',
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

    fields.push(`updated_by = $${idx++}`, `updated_at = now()`);
    values.push(auth.userId, params.id);

    const [updated] = await query<{ id: string }>(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id`,
      values
    );
    if (!updated) return err('Not found', 404);

    return ok(updated);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
