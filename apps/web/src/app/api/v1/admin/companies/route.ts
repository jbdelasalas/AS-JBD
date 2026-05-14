import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }

    const rows = await query<{
      id: string; code: string; name: string; trade_name: string | null;
      tin: string | null; vat_status: string | null; accounting_method: string;
      fiscal_year_start_month: number; is_active: boolean; created_at: string;
    }>(
      `SELECT id, code, name, trade_name, tin, vat_status, accounting_method,
              fiscal_year_start_month, is_active, created_at
         FROM companies
        ORDER BY name`
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(req); } catch (e) { return e as Response; }
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const body = await req.json();
    const {
      code, name, trade_name, tin, vat_status, rdo_code, business_style,
      registered_address, registration_date, books_start_date,
      accounting_method = 'ACCRUAL', fiscal_year_start_month = 1,
    } = body;

    if (!code || !name) return err('code and name are required', 400);

    const [company] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO companies (
         code, name, trade_name, tin, vat_status, rdo_code, business_style,
         registered_address, registration_date, books_start_date,
         accounting_method, fiscal_year_start_month, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, code, name`,
      [code, name, trade_name ?? null, tin ?? null, vat_status ?? null,
       rdo_code ?? null, business_style ?? null, registered_address ?? null,
       registration_date ?? null, books_start_date ?? null,
       accounting_method, fiscal_year_start_month, auth.userId]
    );

    return ok(company, 201);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
