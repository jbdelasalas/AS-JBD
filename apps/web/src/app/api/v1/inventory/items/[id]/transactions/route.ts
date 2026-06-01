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

  const itemId = params.id;

  const [salesRows, purchaseRows, adjRows] = await Promise.all([
    query(
      `SELECT si.invoice_no AS ref, si.invoice_date AS txn_date, si.status,
              sil.quantity, sil.unit_price, sil.line_total,
              c.name AS party_name, si.id AS doc_id, 'sales_invoice' AS txn_type
         FROM sales_invoice_lines sil
         JOIN sales_invoices si ON si.id = sil.invoice_id
         JOIN customers c ON c.id = si.customer_id
        WHERE sil.item_id = $1 AND si.status NOT IN ('cancelled','draft')
        ORDER BY si.invoice_date DESC
        LIMIT 20`,
      [itemId],
    ),
    query(
      `SELECT b.internal_no AS ref, b.bill_date AS txn_date, b.status,
              bl.quantity, bl.unit_price, bl.line_total,
              s.name AS party_name, b.id AS doc_id, 'bill' AS txn_type
         FROM bill_lines bl
         JOIN bills b ON b.id = bl.bill_id
         JOIN suppliers s ON s.id = b.supplier_id
        WHERE bl.item_id = $1 AND b.status NOT IN ('voided','draft')
        ORDER BY b.bill_date DESC
        LIMIT 20`,
      [itemId],
    ),
    query(
      `SELECT sa.adj_no AS ref, sa.posted_at AS txn_date, sa.status,
              sal.qty_adjusted AS quantity, sal.cost_per_unit AS unit_price,
              (sal.qty_adjusted * COALESCE(sal.cost_per_unit, 0)) AS line_total,
              sa.reason_code AS party_name, sa.id AS doc_id, 'adjustment' AS txn_type
         FROM stock_adjustment_lines sal
         JOIN stock_adjustments sa ON sa.id = sal.adj_id
        WHERE sal.item_id = $1 AND sa.status = 'posted'
        ORDER BY sa.posted_at DESC
        LIMIT 20`,
      [itemId],
    ),
  ]);

  type TxnRow = { txn_type: string; quantity: number; txn_date?: unknown; [key: string]: unknown };
  const transactions: TxnRow[] = [
    ...salesRows.map((r) => ({ ...(r as Record<string, unknown>), txn_type: 'sale', quantity: -Number((r as Record<string, unknown>).quantity) })),
    ...purchaseRows.map((r) => ({ ...(r as Record<string, unknown>), txn_type: 'purchase', quantity: Number((r as Record<string, unknown>).quantity) })),
    ...adjRows.map((r) => ({ ...(r as Record<string, unknown>), txn_type: 'adjustment', quantity: Number((r as Record<string, unknown>).quantity) })),
  ].sort((a, b) => String((b as TxnRow).txn_date ?? '').localeCompare(String((a as TxnRow).txn_date ?? '')));

  return ok({
    transactions: transactions.map((r) => ({
      txn_type: String(r.txn_type),
      ref: String(r.ref),
      txn_date: r.txn_date ? String(r.txn_date).split('T')[0] : null,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price ?? 0),
      line_total: Number(r.line_total ?? 0),
      party_name: String(r.party_name ?? ''),
      doc_id: String(r.doc_id),
      status: String(r.status ?? ''),
    })),
  });
}
