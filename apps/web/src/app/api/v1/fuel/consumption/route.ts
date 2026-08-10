export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Gas consumption summary, grouped by employee or by vehicle.
// Only redeemed slips count — a slip that has not come back from the station
// has no litres and no amount behind it yet.

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const groupBy = searchParams.get('group_by') ?? 'employee';
  if (!['employee', 'vehicle'].includes(groupBy)) {
    return err("group_by must be 'employee' or 'vehicle'", 400);
  }

  const params: unknown[] = [companyId];
  let where = `s.company_id = $1 AND s.status = 'redeemed'`;

  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  if (dateFrom) { params.push(dateFrom); where += ` AND s.issue_date >= $${params.length}`; }
  if (dateTo)   { params.push(dateTo);   where += ` AND s.issue_date <= $${params.length}`; }

  // km/L is averaged only across slips that actually produced a figure, so a
  // vehicle's first slip (no prior odometer) does not drag the average down.
  const groupSql = groupBy === 'employee'
    ? {
        key:   `COALESCE(s.employee_id::text, 'x:' || s.issued_to_name)`,
        label: `COALESCE(e.full_name, s.issued_to_name)`,
        sub:   `max(e.employee_no)`,
        join:  `LEFT JOIN employees e ON e.id = s.employee_id`,
      }
    : {
        key:   `COALESCE(s.vehicle_id::text, 'x:' || COALESCE(s.plate_no, '—'))`,
        label: `COALESCE(v.plate_no, s.plate_no, '—')`,
        sub:   `max(v.description)`,
        join:  `LEFT JOIN vehicles v ON v.id = s.vehicle_id`,
      };

  try {
    const rows = await query(
      `SELECT ${groupSql.key}   AS group_key,
              ${groupSql.label} AS label,
              ${groupSql.sub}   AS sublabel,
              count(*)::int          AS slip_count,
              sum(s.actual_litres)   AS total_litres,
              sum(s.amount)          AS total_amount,
              sum(s.km_travelled)    AS total_km,
              avg(s.unit_price)      AS avg_unit_price,
              avg(s.km_per_litre) FILTER (WHERE s.km_per_litre IS NOT NULL) AS avg_km_per_litre,
              max(s.issue_date)      AS last_slip_date
         FROM fuel_po_slips s
         ${groupSql.join}
        WHERE ${where}
        GROUP BY 1, 2
        ORDER BY sum(s.amount) DESC NULLS LAST`,
      params,
    );

    const [totals] = await query<Record<string, unknown>>(
      `SELECT count(*)::int        AS slip_count,
              sum(s.actual_litres) AS total_litres,
              sum(s.amount)        AS total_amount,
              sum(s.km_travelled)  AS total_km
         FROM fuel_po_slips s
        WHERE ${where}`,
      params,
    );

    return ok({
      group_by: groupBy,
      data: rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          group_key: row.group_key,
          label: row.label,
          sublabel: row.sublabel,
          slip_count: row.slip_count,
          total_litres: num(row.total_litres) ?? 0,
          total_amount: num(row.total_amount) ?? 0,
          total_km: num(row.total_km),
          avg_unit_price: num(row.avg_unit_price),
          avg_km_per_litre: num(row.avg_km_per_litre),
          last_slip_date: row.last_slip_date,
        };
      }),
      totals: {
        slip_count: totals.slip_count,
        total_litres: num(totals.total_litres) ?? 0,
        total_amount: num(totals.total_amount) ?? 0,
        total_km: num(totals.total_km),
      },
    });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
