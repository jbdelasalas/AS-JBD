export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { type NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';
import { geocode, PROVIDER_DELAY_MS } from '@/lib/routing/geocode';

// Finds coordinates for a batch of addresses. Cached addresses come back at
// once; new ones go to the provider. On the free provider (one request a
// second) only a few new lookups run per call so the request stays well inside
// the function timeout — the page calls again with `remaining` until done.

const FREE_PROVIDER_LOOKUPS_PER_CALL = 8;

export async function POST(request: NextRequest) {
  try { await requirePermission(request, 'logistics.trip.plan'); } catch (e) { return e as Response; }

  let dto: { company_id?: string; addresses?: { key: string; address: string }[] };
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }
  const companyId = dto.company_id;
  if (!companyId) return err('company_id is required', 400);
  const list = (dto.addresses ?? []).filter((a) => a && a.key && a.address?.trim()).slice(0, 200);

  const results: { key: string; lat?: number; lng?: number; precise?: boolean; formatted?: string | null; error?: string }[] = [];
  const remaining: string[] = [];
  let providerCalls = 0;

  for (const a of list) {
    if (PROVIDER_DELAY_MS > 0 && providerCalls >= FREE_PROVIDER_LOOKUPS_PER_CALL) {
      remaining.push(a.key);
      continue;
    }
    try {
      const { hit, cached } = await geocode(companyId, a.address);
      if (!cached) {
        providerCalls++;
        if (PROVIDER_DELAY_MS) await new Promise((r) => setTimeout(r, PROVIDER_DELAY_MS));
      }
      results.push(hit
        ? { key: a.key, lat: hit.lat, lng: hit.lng, precise: hit.precise || hit.source === 'manual', formatted: hit.formatted }
        : { key: a.key, error: 'address not found' });
    } catch (e) {
      results.push({ key: a.key, error: (e as Error).message });
    }
  }
  return ok({ results, remaining });
}
