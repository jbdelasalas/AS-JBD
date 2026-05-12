export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  return ok({
    userId: auth.userId,
    email: auth.email,
    isSuperadmin: auth.isSuperadmin,
    permissions: auth.permissions,
  });
}
