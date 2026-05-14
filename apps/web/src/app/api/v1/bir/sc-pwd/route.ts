export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapTx(r: Record<string, unknown>) {
  return {
    ...r,
    gross_amount: Number(r.gross_amount),
    discount_rate: Number(r.discount_rate),
    discount_amount: Number(r.discount_amount),
    vat_exemption_amount: Number(r.vat_exemption_amount),
    net_amount: Number(r.net_amount),
  };
}

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const scPwdType = searchParams.get('sc_pwd_type');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');

  const params: unknown[] = [companyId];
  let where = `t.company_id = $1`;
  if (scPwdType) { params.push(scPwdType); where += ` AND t.sc_pwd_type = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); where += ` AND t.transaction_date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); where += ` AND t.transaction_date <= $${params.length}`; }

  params.push(limit, offset);

  try {
    const rows = await query(
      `SELECT t.*, d.document_no, d.document_type
         FROM sc_pwd_transactions t
         JOIN issued_documents d ON d.id = t.document_id
        WHERE ${where}
        ORDER BY t.transaction_date DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM sc_pwd_transactions t WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    // Aggregate summary
    const summaryRows = await query<{ sc_pwd_type: string; total_discount: string; total_transactions: string }>(
      `SELECT t.sc_pwd_type, SUM(t.discount_amount) AS total_discount, COUNT(*)::int AS total_transactions
         FROM sc_pwd_transactions t
        WHERE t.company_id = $1
        GROUP BY t.sc_pwd_type`,
      [companyId],
    );

    return ok({
      data: rows.map((r) => mapTx(r as Record<string, unknown>)),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
      summary: summaryRows.map((r) => ({
        sc_pwd_type: r.sc_pwd_type,
        total_discount: Number(r.total_discount),
        total_transactions: Number(r.total_transactions),
      })),
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
