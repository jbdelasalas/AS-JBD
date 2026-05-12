export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const companies = await query<{ id: string; code: string; name: string }>(
    `SELECT DISTINCT c.id, c.code, c.name
       FROM companies c
       LEFT JOIN user_roles ur ON ur.company_id = c.id
      WHERE c.is_active
        AND ($1 OR ur.user_id = $2)
      ORDER BY c.name`,
    [auth.isSuperadmin, auth.userId],
  );

  return ok(companies);
}
