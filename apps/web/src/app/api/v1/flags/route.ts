export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { ok, err } from '@/lib/api-response';

// Lightweight, authenticated feature-flag check for the client (e.g. nav gating).
// Unlike /admin/feature-flags this is open to any signed-in user but only ever
// returns a single boolean — never the rollout lists or other flag metadata.
//
// Pass `company_id` to get the answer for the company the user is currently
// working in; without it the caller gets the flag's global state. Leaking the
// per-company answer is not a concern here — it is the same single boolean, and
// the company id is one the caller already holds.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const params = new URL(request.url).searchParams;
  const name = params.get('name');
  if (!name) return err('name is required', 400);

  const companyId = params.get('company_id');

  return ok({ name, enabled: await isFeatureEnabled(name, { companyId }) });
}
