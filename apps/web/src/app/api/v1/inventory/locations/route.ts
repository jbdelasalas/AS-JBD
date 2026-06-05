export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Locations = Branches. Returns branches joined with their auto-synced warehouse.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT b.id, b.code, b.name, b.address, b.is_active,
            w.id AS warehouse_id, w.name AS warehouse_name
       FROM branches b
       LEFT JOIN warehouses w ON w.branch_id = b.id AND w.company_id = $1
      WHERE b.company_id = $1
      ORDER BY b.name`,
    [companyId],
  );

  return ok(rows.map((r) => ({
    id:            String(r.id),
    code:          String(r.code),
    name:          String(r.name),
    address:       r.address ? String(r.address) : null,
    is_active:     Boolean(r.is_active),
    warehouse_id:  r.warehouse_id ? String(r.warehouse_id) : null,
    warehouse_name: r.warehouse_name ? String(r.warehouse_name) : null,
  })));
}

// Creating a location here creates a branch + auto-synced warehouse.
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.code || !dto.name) return err('code and name are required', 400);

  try {
    const [branch] = await query<{ id: string; code: string; name: string }>(
      `INSERT INTO branches (company_id, code, name, address)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name`,
      [companyId, String(dto.code).toUpperCase(), dto.name, dto.address ?? null],
    );

    // Auto-create matching warehouse
    const [wh] = await query<{ id: string }>(
      `INSERT INTO warehouses (company_id, branch_id, code, name, address, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, branch_id = EXCLUDED.branch_id
       RETURNING id`,
      [companyId, branch.id, branch.code, branch.name, dto.address ?? null],
    );

    return ok({ ...branch, warehouse_id: wh?.id ?? null }, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to create location', 500);
  }
}
