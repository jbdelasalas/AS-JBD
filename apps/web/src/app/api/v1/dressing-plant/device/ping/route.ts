export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

// IoT & scale ingestion. Hour meters, CT clamps and platform scales POST here.
// Authenticated by a shared device secret (same pattern as the fleet endpoint),
// NOT the user JWT. Every ping lands in dp_device_pings; hour-meter pings also
// upsert a runtime reading and bump the asset's current_runtime_hours.
//
// Payload:
//   { company_id, device_type: 'hour_meter'|'scale'|..., asset_code?, runtime_hours? }

const DEVICE_SECRET = process.env.DP_DEVICE_SECRET ?? 'dp-device-2026';

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-device-secret') ?? '';
  if (secret !== DEVICE_SECRET) return err('Forbidden', 403);

  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = payload.company_id as string | undefined;
  const deviceType = (payload.device_type as string) || 'unknown';

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO dp_device_pings (company_id, device_type, payload) VALUES ($1,$2,$3::jsonb)`,
      [companyId ?? null, deviceType, JSON.stringify(payload)],
    );

    // Hour-meter pings advance machinery runtime (drives the PM sweep).
    if (deviceType === 'hour_meter' && companyId && payload.asset_code && payload.runtime_hours != null) {
      const assetRows = await client.query<{ id: string }>(
        `SELECT id FROM dp_assets_machinery WHERE company_id = $1 AND code = $2 LIMIT 1`,
        [companyId, String(payload.asset_code).toUpperCase()],
      );
      const assetId = assetRows.rows[0]?.id;
      if (assetId) {
        const runtime = Number(payload.runtime_hours);
        await client.query(
          `INSERT INTO dp_machinery_runtime (asset_id, runtime_hours, source) VALUES ($1,$2,'iot')`,
          [assetId, runtime],
        );
        await client.query(
          `UPDATE dp_assets_machinery
              SET current_runtime_hours = GREATEST(current_runtime_hours, $2)
            WHERE id = $1`,
          [assetId, runtime],
        );
      }
    }

    await client.query('COMMIT');
    return ok({ received: true });
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to ingest ping', 500);
  } finally {
    client.release();
  }
}
