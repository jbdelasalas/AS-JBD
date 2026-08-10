export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Capture the bottom half of the slip — the portion the station accomplishes at
// the pump — and derive the consumption figures.
//
// Mileage is taken from the previous redeemed slip on the SAME vehicle, so
// km/L is only meaningful when every gas-up for that vehicle goes through a
// slip. When there is no prior reading (first slip for the vehicle, or no
// vehicle linked) the derived columns stay NULL rather than showing a wrong
// number.

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const actualLitres = num(dto.actual_litres);
  const amount = num(dto.amount);
  const odometer = num(dto.odometer_km);

  if (actualLitres == null || actualLitres <= 0) return err('actual_litres must be greater than 0', 400);
  if (amount == null || amount < 0) return err('amount is required and cannot be negative', 400);
  if (odometer != null && odometer < 0) return err('odometer_km cannot be negative', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Lock the slip so two clerks capturing the same chit cannot both derive
    // mileage off the same prior reading.
    const cur = await client.query(
      `SELECT id, company_id, status, vehicle_id, quantity_litres
         FROM fuel_po_slips WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    const slip = cur.rows[0];
    if (!slip) { await client.query('ROLLBACK'); return err('Slip not found', 404); }
    if (slip.status !== 'issued') {
      await client.query('ROLLBACK');
      return err(`Only issued slips can be redeemed (this one is ${slip.status})`, 409);
    }

    // The printed litres are an authorisation cap. Going over it is a real
    // control breach, so it is rejected unless explicitly overridden.
    const authorised = num(slip.quantity_litres);
    if (authorised != null && actualLitres > authorised && dto.allow_over_limit !== true) {
      await client.query('ROLLBACK');
      return err(
        `Actual ${actualLitres} L exceeds the authorised ${authorised} L on this slip. `
        + `Re-check the pump reading, or resubmit with allow_over_limit to accept the variance.`,
        409,
      );
    }

    // Derive mileage from the previous redeemed slip for the same vehicle.
    let kmTravelled: number | null = null;
    let kmPerLitre: number | null = null;
    if (slip.vehicle_id && odometer != null) {
      const prev = await client.query(
        `SELECT odometer_km FROM fuel_po_slips
          WHERE vehicle_id = $1 AND id <> $2 AND status = 'redeemed' AND odometer_km IS NOT NULL
          ORDER BY odometer_km DESC LIMIT 1`,
        [slip.vehicle_id, params.id],
      );
      const prevOdo = num(prev.rows[0]?.odometer_km);
      if (prevOdo != null) {
        if (odometer < prevOdo) {
          await client.query('ROLLBACK');
          return err(
            `Odometer ${odometer} km is lower than the vehicle's last recorded ${prevOdo} km. `
            + `Check the reading.`,
            400,
          );
        }
        kmTravelled = Number((odometer - prevOdo).toFixed(1));
        if (actualLitres > 0 && kmTravelled > 0) {
          kmPerLitre = Number((kmTravelled / actualLitres).toFixed(3));
        }
      }
    }

    const unitPrice = actualLitres > 0 ? Number((amount / actualLitres).toFixed(4)) : null;

    const res = await client.query(
      `UPDATE fuel_po_slips SET
         status = 'redeemed',
         station_name = $2,
         gas_up_at = COALESCE($3, now()),
         odometer_km = $4,
         actual_litres = $5,
         official_receipt_no = $6,
         catered_by = $7,
         amount = $8,
         unit_price = $9,
         km_travelled = $10,
         km_per_litre = $11,
         notes = COALESCE($12, notes),
         redeemed_by = $13,
         redeemed_at = now()
       WHERE id = $1
       RETURNING id, slip_no, status, actual_litres, amount, unit_price, km_travelled, km_per_litre`,
      [
        params.id,
        (dto.station_name as string)?.trim() || null,
        dto.gas_up_at ?? null,
        odometer,
        actualLitres,
        (dto.official_receipt_no as string)?.trim() || null,
        (dto.catered_by as string)?.trim() || null,
        amount,
        unitPrice,
        kmTravelled,
        kmPerLitre,
        (dto.notes as string) || null,
        auth.userId,
      ],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1,$2,'redeem','fuel_po_slip',$3)`,
      [auth.userId, slip.company_id, params.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const r = res.rows[0];
    return ok({
      ...r,
      actual_litres: num(r.actual_litres),
      amount: num(r.amount),
      unit_price: num(r.unit_price),
      km_travelled: num(r.km_travelled),
      km_per_litre: num(r.km_per_litre),
      over_limit: authorised != null && actualLitres > authorised,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message ?? 'Failed to redeem slip', 500);
  } finally {
    client.release();
  }
}
