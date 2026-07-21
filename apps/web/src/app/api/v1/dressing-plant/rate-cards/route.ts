export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Effective-dated rate cards. Invoices reference the rate live on the batch date,
// so adding a new effective row never rewrites historical bills.

const SERVICES = ['basic_tolling', 'cutups', 'marination', 'blast', 'storage', 'doa'];

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT id, service, unit, amount, effective_from
       FROM dp_rate_cards WHERE company_id = $1
      ORDER BY service, effective_from DESC`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  const service = dto.service as string;
  if (!SERVICES.includes(service)) return err(`service must be one of: ${SERVICES.join(', ')}`, 400);
  if (!dto.unit) return err('unit is required', 400);
  const amount = Number(dto.amount);
  if (!(amount > 0)) return err('amount must be greater than 0', 400);
  if (!dto.effective_from) return err('effective_from is required', 400);

  try {
    const [row] = await query<{ id: string }>(
      `INSERT INTO dp_rate_cards (company_id, service, unit, amount, effective_from)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, service, dto.unit, amount, dto.effective_from],
    );
    return ok(row, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to create rate', 500);
  }
}
