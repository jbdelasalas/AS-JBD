export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const startDate = searchParams.get('start_date');
  const endDate   = searchParams.get('end_date');
  if (!startDate || !endDate) return err('start_date and end_date are required', 400);

  const groupBy = (searchParams.get('group_by') ?? 'day') as 'day' | 'month';
  const detail  = searchParams.get('detail') === 'true';

  try {
    const t0 = Date.now();

    // Summary rows
    const summary = await query<{
      period: string; doc_count: string; vatable: string; vat_amount: string;
      exempt: string; zero_rated: string; gross_sales: string; net_sales: string;
    }>(
      `SELECT * FROM sales_summary($1, $2::date, $3::date, $4)`,
      [companyId, startDate, endDate, groupBy],
    );

    // Optional detail rows from the view
    let detailRows: unknown[] = [];
    if (detail) {
      detailRows = await query(
        `SELECT document_type, document_no, transaction_date, customer_name, customer_tin,
                vatable_amount, vat_amount, vat_exempt_amount, zero_rated_amount,
                total_amount, net_amount, status
           FROM v_sales_register
          WHERE company_id = $1
            AND transaction_date BETWEEN $2 AND $3
            AND status = 'active'
          ORDER BY transaction_date, document_no`,
        [companyId, startDate, endDate],
      );
    }

    const mappedSummary = summary.map((r) => ({
      period: r.period,
      doc_count: Number(r.doc_count),
      vatable: Number(r.vatable),
      vat_amount: Number(r.vat_amount),
      exempt: Number(r.exempt),
      zero_rated: Number(r.zero_rated),
      gross_sales: Number(r.gross_sales),
      net_sales: Number(r.net_sales),
    }));

    const totals = mappedSummary.reduce((acc, r) => ({
      doc_count:  acc.doc_count + r.doc_count,
      vatable:    acc.vatable + r.vatable,
      vat_amount: acc.vat_amount + r.vat_amount,
      exempt:     acc.exempt + r.exempt,
      zero_rated: acc.zero_rated + r.zero_rated,
      gross_sales: acc.gross_sales + r.gross_sales,
      net_sales:  acc.net_sales + r.net_sales,
    }), { doc_count: 0, vatable: 0, vat_amount: 0, exempt: 0, zero_rated: 0, gross_sales: 0, net_sales: 0 });

    return ok({
      start_date: startDate,
      end_date: endDate,
      group_by: groupBy,
      summary: mappedSummary,
      totals,
      detail: detailRows,
      duration_ms: Date.now() - t0,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
