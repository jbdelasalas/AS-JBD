export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Configurable required fields. GET lists the fields for a form (or all forms);
// PUT saves the required on/off toggles in bulk.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const params: unknown[] = [companyId];
  let where = `company_id = $1`;
  const formKey = searchParams.get('form_key');
  if (formKey) { params.push(formKey); where += ` AND form_key = $${params.length}`; }

  const rows = await query(
    `SELECT id, form_key, field_key, label, required, sort_order
       FROM field_requirements WHERE ${where}
      ORDER BY form_key, sort_order, label`,
    params,
  );
  return ok({ data: rows });
}

export async function PUT(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  const items = Array.isArray(dto.items) ? (dto.items as Array<{ id?: string; field_key?: string; form_key?: string; required?: boolean }>) : [];
  if (items.length === 0) return err('items is required', 400);

  try {
    for (const it of items) {
      if (it.id) {
        await query(
          `UPDATE field_requirements SET required = $1, updated_at = now()
            WHERE id = $2 AND company_id = $3`,
          [!!it.required, it.id, companyId],
        );
      } else if (it.form_key && it.field_key) {
        await query(
          `UPDATE field_requirements SET required = $1, updated_at = now()
            WHERE company_id = $2 AND form_key = $3 AND field_key = $4`,
          [!!it.required, companyId, it.form_key, it.field_key],
        );
      }
    }
    return ok({ updated: items.length });
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to save', 500);
  }
}
