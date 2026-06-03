export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }
  const companyId = request.nextUrl.searchParams.get('company_id');
  if (!companyId) return err('company_id required', 400);

  const rows = await query(
    `SELECT st.id, st.tally_no, st.tally_date, st.delivery_date,
            st.customer_name, st.status, st.allocation_id,
            c.name AS customer_name_live, c.code AS customer_code,
            oa.allocation_no
       FROM sales_tally_sheets st
       JOIN customers c ON c.id = st.customer_id
       LEFT JOIN order_allocations oa ON oa.id = st.allocation_id
      WHERE st.company_id = $1
      ORDER BY st.tally_date DESC, st.tally_no DESC
      LIMIT 200`,
    [companyId],
  );
  return ok({ data: rows });
}
