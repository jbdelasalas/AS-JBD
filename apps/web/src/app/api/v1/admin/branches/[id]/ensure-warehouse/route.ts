export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Creates a warehouse for a branch that doesn't have one yet.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }

  const [branch] = await query<{ id: string; company_id: string; code: string; name: string; address: string | null }>(
    `SELECT id, company_id, code, name, address FROM branches WHERE id = $1`, [params.id]);
  if (!branch) return err('Branch not found', 404);

  // Check if warehouse already exists
  const [existing] = await query<{ id: string }>(
    `SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1`, [params.id]);
  if (existing) return ok({ warehouse_id: existing.id, created: false });

  const [wh] = await query<{ id: string }>(
    `INSERT INTO warehouses (company_id, branch_id, code, name, address, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (company_id, code) DO UPDATE SET branch_id = EXCLUDED.branch_id
     RETURNING id`,
    [branch.company_id, branch.id, branch.code, branch.name, branch.address]);

  return ok({ warehouse_id: wh.id, created: true });
}
