export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Bulk-creates missing warehouses for all branches that don't have one.
export async function POST(req: NextRequest) {
  try { await requireAuth(req); } catch (e) { return e as Response; }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const branches = await query<{ id: string; code: string; name: string; address: string | null }>(
    `SELECT b.id, b.code, b.name, b.address
       FROM branches b
      WHERE b.company_id = $1
        AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.branch_id = b.id)
      ORDER BY b.name`,
    [companyId]);

  if (branches.length === 0) return ok({ created: 0, names: [] });

  const created: string[] = [];
  for (const b of branches) {
    await query(
      `INSERT INTO warehouses (company_id, branch_id, code, name, address, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (company_id, code) DO UPDATE SET branch_id = EXCLUDED.branch_id`,
      [companyId, b.id, b.code, b.name, b.address],
    ).catch(() => {});
    created.push(b.name);
  }

  return ok({ created: created.length, names: created });
}
