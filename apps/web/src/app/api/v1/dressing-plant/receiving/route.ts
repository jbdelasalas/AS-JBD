export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Module A — Receiving & Weighing, one row per truck. The first truck fires a
// DB trigger that locks the batch (no journal entry here). net_live_weight_kg
// (plant weight) is a generated column (gross - tare); head_count is the plant
// count. Trucks can be added until the batch's receiving is marked complete.

const TRUCK_COLS = `rw.id, rw.job_order_id, rw.seq, rw.plate_no, rw.seal_no, rw.farm_name, rw.farm_address, rw.house_no,
  rw.farm_count, rw.farm_weight_kg, rw.gross_weight_kg, rw.tare_weight_kg, rw.net_live_weight_kg,
  rw.coop_count, rw.head_count, rw.doa_count, rw.doa_weight_kg,
  to_char(rw.farm_departure, 'HH24:MI') AS farm_departure, to_char(rw.plant_arrival, 'HH24:MI') AS plant_arrival,
  to_char(rw.start_hang, 'HH24:MI') AS start_hang, to_char(rw.end_hang, 'HH24:MI') AS end_hang,
  rw.received_at`;

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);
  const jobOrderId = searchParams.get('job_order_id');

  const params: unknown[] = [companyId];
  let where = `jo.company_id = $1`;
  if (jobOrderId) { params.push(jobOrderId); where += ` AND rw.job_order_id = $${params.length}`; }

  const rows = await query(
    `SELECT ${TRUCK_COLS}, jo.batch_no, c.name AS client_name
       FROM dp_receiving_weights rw
       JOIN dp_job_orders jo ON jo.id = rw.job_order_id
       JOIN dp_clients c ON c.id = jo.client_id
      WHERE ${where}
      ORDER BY ${jobOrderId ? 'rw.seq, rw.received_at' : 'rw.received_at DESC'}`,
    params,
  );
  return ok({ data: rows });
}

const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const hhmm = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() : null);

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const jobOrderId = dto.job_order_id as string;
  if (!jobOrderId) return err('job_order_id is required', 400);
  const gross = Number(dto.gross_weight_kg);
  if (!(gross > 0)) return err('Gross weight must be greater than 0', 400);
  const headCount = Number(dto.head_count);
  if (!(headCount > 0)) return err('Plant count must be greater than 0', 400);

  try {
    // Refused once the batch's receiving is complete; seq = next arrival number.
    const [row] = await query<{ id: string; seq: number }>(
      `INSERT INTO dp_receiving_weights
         (job_order_id, seq, plate_no, seal_no, farm_name, farm_address, house_no, farm_count, farm_weight_kg,
          gross_weight_kg, tare_weight_kg, coop_count, head_count, doa_count, doa_weight_kg,
          farm_departure, plant_arrival, start_hang, end_hang, created_by)
       SELECT $1::uuid,
              (SELECT COALESCE(MAX(seq), 0) + 1 FROM dp_receiving_weights WHERE job_order_id = $1::uuid),
              $2::varchar, $3::varchar, $4::text, $5::text, $6::varchar, $7::int, $8::numeric,
              $9::numeric, $10::numeric, $11::int, $12::int, $13::int, $14::numeric,
              $15::time, $16::time, $17::time, $18::time, $19::uuid
        WHERE EXISTS (SELECT 1 FROM dp_job_orders WHERE id = $1::uuid AND receiving_completed_at IS NULL)
       RETURNING id, seq`,
      [
        jobOrderId, txt(dto.plate_no), txt(dto.seal_no), txt(dto.farm_name), txt(dto.farm_address), txt(dto.house_no),
        num(dto.farm_count), num(dto.farm_weight_kg),
        gross, num(dto.tare_weight_kg) ?? 0, num(dto.coop_count) ?? 0, headCount, num(dto.doa_count) ?? 0, num(dto.doa_weight_kg),
        hhmm(dto.farm_departure), hhmm(dto.plant_arrival), hhmm(dto.start_hang), hhmm(dto.end_hang),
        auth.userId,
      ],
    );
    if (!row) return err('Receiving for this batch is already complete', 409);
    return ok(row, 201);
  } catch (e: unknown) {
    return err((e as Error).message ?? 'Failed to record receiving', 500);
  }
}

// Remove a truck entered by mistake — only while the batch is still receiving.
export async function DELETE(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return err('id is required', 400);
  const rows = await query(
    `DELETE FROM dp_receiving_weights rw USING dp_job_orders jo
      WHERE rw.id = $1 AND jo.id = rw.job_order_id AND jo.receiving_completed_at IS NULL
      RETURNING rw.id`,
    [id],
  );
  if (!rows.length) return err('Not found, or receiving for this batch is already complete', 409);
  return ok({ deleted: true });
}
