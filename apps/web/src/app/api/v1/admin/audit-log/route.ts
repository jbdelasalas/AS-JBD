import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    return e as Response;
  }
  if (!auth.isSuperadmin) return err('Forbidden', 403);

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('company_id');
  const entityType = searchParams.get('table_name'); // UI still sends "table_name"
  const userId = searchParams.get('user_id');
  const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 500);

  try {
    const rows = await query<{
      id: string; company_id: string | null; user_id: string | null;
      user_email: string | null; action: string; entity_type: string;
      entity_id: string | null; before_state: Record<string, unknown> | null;
      after_state: Record<string, unknown> | null; ip_address: string | null;
      occurred_at: string;
    }>(
      `SELECT al.id, al.company_id, al.user_id, u.email AS user_email,
              al.action, al.entity_type, al.entity_id,
              al.before_state, al.after_state, al.ip_address, al.occurred_at
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
        WHERE ($1::uuid IS NULL OR al.company_id = $1)
          AND ($2::text IS NULL OR al.entity_type = $2)
          AND ($3::uuid IS NULL OR al.user_id = $3)
        ORDER BY al.occurred_at DESC
        LIMIT $4`,
      [companyId, entityType, userId, limit]
    );

    // Map to the shape the frontend expects
    return ok(rows.map((r) => ({
      ...r,
      table_name: r.entity_type,
      record_id: r.entity_id,
      old_values: r.before_state,
      new_values: r.after_state,
      created_at: r.occurred_at,
    })));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
