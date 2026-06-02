export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const search = searchParams.get('search');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const minimal = searchParams.get('minimal') === 'true';

  const params: unknown[] = [companyId];
  let where = `s.company_id = $1 AND s.is_active = true`;

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (s.name ILIKE $${params.length} OR s.code ILIKE $${params.length})`;
  }

  try {
    if (minimal) {
      params.push(limit);
      const rows = await query(
        `SELECT id, code, name FROM suppliers s WHERE ${where} ORDER BY name ASC LIMIT $${params.length}`,
        params,
      );
      return ok({ data: rows });
    }

    params.push(limit, offset);

    const rows = await query(
      `SELECT s.*,
              COALESCE(SUM(b.balance), 0) AS open_ap_balance
         FROM suppliers s
         LEFT JOIN bills b ON b.supplier_id = s.id
           AND b.status IN ('approved','partial')
        WHERE ${where}
        GROUP BY s.id
        ORDER BY s.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM suppliers s WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return ok({
      data: rows.map((r) => ({
        ...r,
        open_ap_balance: Number((r as Record<string, unknown>).open_ap_balance),
      })),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const companyId = dto.company_id as string;
  if (!companyId || !dto.name) return err('company_id and name are required', 400);

  const seqRows = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM suppliers WHERE company_id = $1`,
    [companyId],
  );
  const seq = seqRows[0].c + 1;
  const code = `SUPP-${String(seq).padStart(6, '0')}`;

  const existing = await query(
    `SELECT id FROM suppliers WHERE company_id = $1 AND code = $2`,
    [companyId, code],
  );
  if (existing.length) return err(`Supplier code ${code} already exists`, 409);

  const rows = await query(
    `INSERT INTO suppliers
       (company_id, code, name, supplier_type, tin, address, contact_person,
        email, phone, payment_terms_days, is_vat_registered, ewt_rate, is_active, ap_account_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      companyId, code, dto.name,
      dto.supplier_type ?? 'trade',
      dto.tin ?? null,
      dto.address ?? null,
      dto.contact_person ?? null,
      dto.email ?? null,
      dto.phone ?? null,
      dto.payment_terms_days ?? 30,
      dto.is_vat_registered ?? true,
      dto.ewt_rate ?? 0,
      true,
      dto.ap_account_id ?? null,
    ],
  );
  const supplier = rows[0] as Record<string, unknown>;

  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.userId, companyId, 'create', 'supplier', supplier.id, JSON.stringify(supplier)],
  ).catch(() => {/* non-fatal */});

  return ok(supplier, 201);
}
