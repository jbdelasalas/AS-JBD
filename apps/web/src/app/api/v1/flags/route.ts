export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { ok, err } from '@/lib/api-response';

// Lightweight, authenticated feature-flag check for the client (e.g. nav gating).
// Unlike /admin/feature-flags this is open to any signed-in user but only ever
// returns a single boolean — never the rollout lists or other flag metadata.
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const name = new URL(request.url).searchParams.get('name');
  if (!name) return err('name is required', 400);

  return ok({ name, enabled: await isFeatureEnabled(name) });
}
