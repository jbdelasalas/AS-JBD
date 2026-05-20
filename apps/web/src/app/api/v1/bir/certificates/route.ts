export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapCert(r: Record<string, unknown>) {
  return {
    ...r,
    taxable_amount: Number(r.taxable_amount),
    rate_pct: Number(r.rate_pct),
    amount_withheld: Number(r.amount_withheld),
  };
}

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const year = searchParams.get('year');
  const quarter = searchParams.get('quarter');
  const supplierId = searchParams.get('supplier_id');
  const billId = searchParams.get('bill_id');
  const status = searchParams.get('status');

  const params: unknown[] = [companyId];
  let where = `wc.company_id = $1`;
  if (year) { params.push(parseInt(year)); where += ` AND wc.period_year = $${params.length}`; }
  if (quarter) { params.push(parseInt(quarter)); where += ` AND wc.period_quarter = $${params.length}`; }
  if (supplierId) { params.push(supplierId); where += ` AND wc.supplier_id = $${params.length}`; }
  if (billId) { params.push(billId); where += ` AND wc.bill_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND wc.status = $${params.length}`; }

  try {
    const rows = await query(
      `SELECT wc.*, s.name AS supplier_name, s.tin AS supplier_tin,
              b.bill_no, b.bill_date
         FROM wht_certificates wc
         JOIN suppliers s ON s.id = wc.supplier_id
         JOIN bills b ON b.id = wc.bill_id
        WHERE ${where}
        ORDER BY wc.period_year DESC, wc.period_quarter DESC, wc.cert_no DESC`,
      params,
    );

    return ok(rows.map((r) => mapCert(r as Record<string, unknown>)));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.bill_id) return err('bill_id is required', 400);
  if (!dto.supplier_id) return err('supplier_id is required', 400);
  if (!dto.bir_atc_code) return err('bir_atc_code is required', 400);
  if (!dto.taxable_amount || !dto.rate_pct) return err('taxable_amount and rate_pct are required', 400);
  if (!dto.period_year || !dto.period_quarter) return err('period_year and period_quarter are required', 400);

  const taxableAmount = Number(dto.taxable_amount);
  const ratePct = Number(dto.rate_pct);
  const amountWithheld = parseFloat((taxableAmount * (ratePct / 100)).toFixed(2));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seq = await client.query(
      `SELECT COUNT(*)::int AS c FROM wht_certificates WHERE company_id = $1`,
      [companyId],
    );
    const certNo = `2307-${dto.period_year}-${dto.period_quarter}-${String(seq.rows[0].c + 1).padStart(5, '0')}`;

    const ins = await client.query(
      `INSERT INTO wht_certificates
         (company_id, cert_no, bill_id, supplier_id, bir_atc_code, taxable_amount,
          rate_pct, amount_withheld, period_year, period_quarter, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
       RETURNING *`,
      [
        companyId, certNo, dto.bill_id, dto.supplier_id, dto.bir_atc_code,
        taxableAmount.toFixed(2), ratePct, amountWithheld.toFixed(2),
        dto.period_year, dto.period_quarter, auth.userId,
      ],
    );

    await client.query('COMMIT');

    const result = await query(
      `SELECT wc.*, s.name AS supplier_name FROM wht_certificates wc
         JOIN suppliers s ON s.id = wc.supplier_id
        WHERE wc.id = $1`,
      [ins.rows[0].id],
    );

    return ok(mapCert(result[0] as Record<string, unknown>), 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
