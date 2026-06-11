export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';
import { resolvePortalCustomer } from '@/lib/portal-helpers';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const res = await resolvePortalCustomer(auth);
  if ('response' in res) return res.response;

  return ok({ customer: res.customer });
}
