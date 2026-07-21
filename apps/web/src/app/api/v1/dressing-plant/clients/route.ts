export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Tolling clients — the customers whose birds the plant dresses. Optionally
// linked to an ERP customer for downstream AR.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT c.id, c.code, c.name, c.credit_allowed, c.is_active,
            c.customer_id, cu.name AS customer_name
       FROM dp_clients c
       LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.company_id = $1
      ORDER BY c.name`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code) return err('code is required', 400);
  if (!dto.name) return err('name is required', 400);

  try {
    const [row] = await query<{ id: string }>(
      `INSERT INTO dp_clients (company_id, code, name, customer_id, credit_allowed, is_active)
       VALUES ($1,$2,$3,$4,COALESCE($5,false),COALESCE($6,true))
       RETURNING id`,
      [
        companyId,
        String(dto.code).toUpperCase(),
        dto.name,
        (dto.customer_id as string) || null,
        dto.credit_allowed as boolean | undefined ?? null,
        dto.is_active as boolean | undefined ?? null,
      ],
    );
    await query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'create','dp_client',$3)`,
      [auth.userId, companyId, row.id],
    ).catch(() => {});
    return ok(row, 201);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? 'Failed to create client';
    if (/unique|duplicate/i.test(msg)) return err(`Client ${dto.code} already exists`, 409);
    return err(msg, 500);
  }
}
