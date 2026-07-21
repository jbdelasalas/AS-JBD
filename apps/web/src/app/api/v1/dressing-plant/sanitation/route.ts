export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Sanitation logs. When a chemical + qty + unit cost is captured, the log posts
// consumption Dr 5230 Sanitation Chemicals / Cr 1140 Processing Supplies.

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const companyId = new URL(request.url).searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const rows = await query(
    `SELECT s.id, s.area, s.qty, s.unit_cost, s.consumption_posted, s.logged_at,
            s.item_id, i.name AS item_name, s.job_order_id, jo.batch_no
       FROM dp_sanitation_logs s
       LEFT JOIN items i ON i.id = s.item_id
       LEFT JOIN dp_job_orders jo ON jo.id = s.job_order_id
      WHERE s.company_id = $1
      ORDER BY s.logged_at DESC`,
    [companyId],
  );
  return ok({ data: rows });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.area) return err('area is required', 400);
  const qty = dto.qty != null ? Number(dto.qty) : 0;
  const unitCost = dto.unit_cost != null ? Number(dto.unit_cost) : 0;
  const amount = parseFloat((qty * unitCost).toFixed(2));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const logRows = await client.query<{ id: string }>(
      `INSERT INTO dp_sanitation_logs
         (company_id, job_order_id, area, item_id, qty, unit_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        companyId, (dto.job_order_id as string) || null, dto.area,
        (dto.item_id as string) || null, qty, unitCost, auth.userId,
      ],
    );
    const logId = logRows.rows[0].id;

    let entryId: string | null = null;
    if (amount > 0) {
      const je = await client.query<{ id: string }>(
        `SELECT dp_post_journal($1,'sanitation_consumption',$2,$3::jsonb,$4,NULL,$5) AS id`,
        [
          companyId, logId,
          JSON.stringify([
            { code: '5230', dr: amount, cr: 0 },
            { code: '1140', dr: 0, cr: amount },
          ]),
          'Sanitation chemical consumed',
          auth.userId,
        ],
      );
      entryId = je.rows[0].id;
      await client.query(`UPDATE dp_sanitation_logs SET consumption_posted = true WHERE id = $1`, [logId]);
    }

    await client.query('COMMIT');
    return ok({ id: logId, amount, journal_entry_id: entryId }, 201);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Failed to log sanitation', 500);
  } finally {
    client.release();
  }
}
