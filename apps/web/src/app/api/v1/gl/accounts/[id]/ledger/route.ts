export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok } from '@/lib/api-response';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const accountId = params.id;
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200);

  const rows = await query(
    `SELECT jel.id, jel.line_no, jel.debit, jel.credit, jel.description,
            jel.customer_id, c.code AS customer_code, c.name AS customer_name,
            je.id AS entry_id, je.entry_no, je.entry_date, je.memo,
            je.status, je.source_module, je.source_doc_type, je.source_doc_id
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id
       LEFT JOIN customers c ON c.id = jel.customer_id
      WHERE jel.account_id = $1 AND je.status = 'posted'
      ORDER BY je.entry_date DESC, je.entry_no DESC
      LIMIT $2`,
    [accountId, limit],
  );

  let runningBalance = 0;
  const withBalance = [...rows].reverse().map((r) => {
    const row = r as Record<string, unknown>;
    runningBalance += Number(row.debit) - Number(row.credit);
    return {
      id: String(row.id),
      entry_id: String(row.entry_id),
      entry_no: String(row.entry_no),
      entry_date: String(row.entry_date).split('T')[0],
      description: row.description ? String(row.description) : null,
      memo: row.memo ? String(row.memo) : null,
      source_module: String(row.source_module ?? ''),
      source_doc_type: row.source_doc_type ? String(row.source_doc_type) : null,
      source_doc_id: row.source_doc_id ? String(row.source_doc_id) : null,
      customer_id: row.customer_id ? String(row.customer_id) : null,
      customer_code: row.customer_code ? String(row.customer_code) : null,
      customer_name: row.customer_name ? String(row.customer_name) : null,
      debit: Number(row.debit),
      credit: Number(row.credit),
      balance: runningBalance,
    };
  }).reverse();

  return ok(withBalance);
}
