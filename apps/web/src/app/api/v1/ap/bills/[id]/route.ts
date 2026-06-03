export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    ewt_amount: Number(r.ewt_amount ?? 0),
    total: Number(r.total),
    amount_paid: Number(r.amount_paid),
    balance: Number(r.balance),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    vat_rate: Number(l.vat_rate),
    ewt_rate: Number(l.ewt_rate ?? 0),
    line_subtotal: Number(l.line_subtotal),
    line_vat: Number(l.line_vat),
    line_total: Number(l.line_total),
    ewt_amount: Number(l.ewt_amount ?? 0),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  // Try full query with EWT code join; fall back gracefully if migration 034 is pending
  let rows: Record<string, unknown>[];
  try {
    rows = await query(
      `SELECT b.*,
              s.name AS supplier_name, s.code AS supplier_code,
              s.address AS supplier_address, s.payment_terms_days AS supplier_terms,
              br.code AS branch_code, br.name AS branch_name,
              fb.code AS building_code, fb.name AS building_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name,
              gr.code AS grow_ref_code, gr.name AS grow_ref_name,
              po.po_no AS po_no,
              tc.code AS ewt_code, tc.name AS ewt_code_name, tc.rate_pct AS ewt_code_rate,
              tc.bir_atc_code AS ewt_atc_code
         FROM bills b
         JOIN suppliers s ON s.id = b.supplier_id
         LEFT JOIN branches br ON br.id = b.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = b.building_id
         LEFT JOIN cost_centers cc ON cc.id = b.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = b.grow_reference_id
         LEFT JOIN purchase_orders po ON po.id = b.po_id
         LEFT JOIN tax_codes tc ON tc.id = b.ewt_code_id
        WHERE b.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  } catch {
    // ewt_code_id column missing (migration 034 not yet run) — fall back without EWT join
    rows = await query(
      `SELECT b.*,
              s.name AS supplier_name, s.code AS supplier_code,
              s.address AS supplier_address, s.payment_terms_days AS supplier_terms,
              br.code AS branch_code, br.name AS branch_name,
              fb.code AS building_code, fb.name AS building_name,
              cc.code AS cost_center_code, cc.name AS cost_center_name,
              gr.code AS grow_ref_code, gr.name AS grow_ref_name,
              po.po_no AS po_no
         FROM bills b
         JOIN suppliers s ON s.id = b.supplier_id
         LEFT JOIN branches br ON br.id = b.branch_id
         LEFT JOIN farm_buildings fb ON fb.id = b.building_id
         LEFT JOIN cost_centers cc ON cc.id = b.cost_center_id
         LEFT JOIN grow_references gr ON gr.id = b.grow_reference_id
         LEFT JOIN purchase_orders po ON po.id = b.po_id
        WHERE b.id = $1 LIMIT 1`,
      [params.id],
    ) as Record<string, unknown>[];
  }
  if (!rows[0]) return err(`Bill ${params.id} not found`, 404);

  const lines = await query(
    `SELECT bl.*, a.name AS account_name, a.code AS account_code
       FROM bill_lines bl
       LEFT JOIN accounts a ON a.id = bl.expense_account_id
      WHERE bl.bill_id = $1
      ORDER BY bl.line_no`,
    [params.id],
  );

  return ok({
    ...mapRow(rows[0] as Record<string, unknown>),
    lines: lines.map((l) => mapLine(l as Record<string, unknown>)),
  });
}
