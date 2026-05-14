import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('company_id');
    const tableName = searchParams.get('table_name');
    const userId = searchParams.get('user_id');
    const limit = Math.min(Number(searchParams.get('limit') ?? '100'), 500);

    const rows = await query<{
      id: string; company_id: string | null; user_id: string | null;
      user_email: string | null; action: string; table_name: string;
      record_id: string | null; old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null; ip_address: string | null;
      created_at: string;
    }>(
      `SELECT al.id, al.company_id, al.user_id, u.email AS user_email,
              al.action, al.table_name, al.record_id,
              al.old_values, al.new_values, al.ip_address, al.created_at
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
        WHERE ($1::uuid IS NULL OR al.company_id = $1)
          AND ($2::text IS NULL OR al.table_name = $2)
          AND ($3::uuid IS NULL OR al.user_id = $3)
        ORDER BY al.created_at DESC
        LIMIT $4`,
      [companyId, tableName, userId, limit]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
