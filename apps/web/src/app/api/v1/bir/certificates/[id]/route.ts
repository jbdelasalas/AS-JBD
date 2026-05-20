export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  try {
    const rows = await query(
      `SELECT wc.*,
              s.name AS supplier_name, s.tin AS supplier_tin, s.address AS supplier_address,
              co.name AS company_name, co.bir_tin AS company_tin,
              co.registered_address AS company_address,
              b.bill_no, b.bill_date, b.internal_no,
              tc.name AS atc_description
         FROM wht_certificates wc
         JOIN suppliers s ON s.id = wc.supplier_id
         JOIN companies co ON co.id = wc.company_id
         JOIN bills b ON b.id = wc.bill_id
         LEFT JOIN tax_codes tc ON tc.company_id = wc.company_id
                                AND tc.bir_atc_code = wc.bir_atc_code
                                AND tc.tax_type = 'ewt'
        WHERE wc.id = $1 LIMIT 1`,
      [params.id],
    );

    if (!rows[0]) return err('Certificate not found', 404);
    return ok(mapCert(rows[0] as Record<string, unknown>));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const { status } = dto as { status?: string };
  if (!status) return err('status is required', 400);
  if (!['draft', 'issued', 'filed'].includes(status)) return err('Invalid status', 400);

  try {
    const now = new Date().toISOString();
    const rows = await query(
      `UPDATE wht_certificates
          SET status = $2,
              issued_at = CASE WHEN $2 = 'issued' THEN $3::timestamptz ELSE issued_at END,
              filed_at  = CASE WHEN $2 = 'filed'  THEN $3::timestamptz ELSE filed_at  END
        WHERE id = $1
        RETURNING *`,
      [params.id, status, now],
    );
    if (!rows[0]) return err('Certificate not found', 404);
    return ok(mapCert(rows[0] as Record<string, unknown>));
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
