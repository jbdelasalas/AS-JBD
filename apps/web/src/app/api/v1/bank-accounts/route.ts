export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT ba.id, ba.account_name, ba.bank_name, ba.account_number,
            ba.gl_account_id, ba.is_active,
            a.code AS gl_code, a.name AS gl_name
       FROM bank_accounts ba
       LEFT JOIN accounts a ON a.id = ba.gl_account_id
      WHERE ba.company_id = $1
      ORDER BY ba.account_name`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const dto = await request.json().catch(() => null);
  if (!dto?.company_id || !dto?.account_name) return err('company_id and account_name are required', 400);

  const rows = await query(
    `INSERT INTO bank_accounts (company_id, account_name, bank_name, account_number, gl_account_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [dto.company_id, dto.account_name, dto.bank_name ?? null, dto.account_number ?? null, dto.gl_account_id ?? null],
  );
  return ok(rows[0], 201);
}
