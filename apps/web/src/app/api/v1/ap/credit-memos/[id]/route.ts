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
    total: Number(r.total),
    amount_applied: Number(r.amount_applied ?? 0),
    balance: Number(r.balance),
  };
}

function mapLine(l: Record<string, unknown>) {
  return {
    ...l,
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    vat_rate: Number(l.vat_rate),
    line_subtotal: Number(l.line_subtotal),
    line_vat: Number(l.line_vat),
    line_total: Number(l.line_total),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query(
    `SELECT cm.*,
            s.name AS supplier_name, s.code AS supplier_code,
            s.address AS supplier_address, s.payment_terms_days AS supplier_terms,
            br.code AS branch_code, br.name AS branch_name,
            fb.code AS building_code, fb.name AS building_name,
            cc.code AS cost_center_code, cc.name AS cost_center_name,
            gr.code AS grow_ref_code, gr.name AS grow_ref_name,
            b.bill_no AS linked_bill_no
       FROM bill_credit_memos cm
       JOIN suppliers s ON s.id = cm.supplier_id
       LEFT JOIN branches br ON br.id = cm.branch_id
       LEFT JOIN farm_buildings fb ON fb.id = cm.building_id
       LEFT JOIN cost_centers cc ON cc.id = cm.cost_center_id
       LEFT JOIN grow_references gr ON gr.id = cm.grow_reference_id
       LEFT JOIN bills b ON b.id = cm.bill_id
      WHERE cm.id = $1 LIMIT 1`,
    [params.id],
  ).catch(() => null as unknown as Record<string, unknown>[]);

  if (!rows || !rows[0]) return err('Credit memo not found', 404);

  const lines = await query(
    `SELECT l.*, a.name AS account_name, a.code AS account_code
       FROM bill_credit_memo_lines l
       LEFT JOIN accounts a ON a.id = l.expense_account_id
      WHERE l.memo_id = $1 ORDER BY l.line_no`,
    [params.id],
  );

  return ok({ ...mapRow(rows[0] as Record<string, unknown>), lines: lines.map(l => mapLine(l as Record<string, unknown>)) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  const rows = await query<{ status: string; company_id: string }>(
    `SELECT status, company_id FROM bill_credit_memos WHERE id = $1`, [params.id]);
  if (!rows[0]) return err('Not found', 404);
  if (rows[0].status !== 'draft') return err('Only draft credit memos can be deleted', 409);

  await query(`DELETE FROM bill_credit_memo_lines WHERE memo_id = $1`, [params.id]);
  await query(`DELETE FROM bill_credit_memos WHERE id = $1`, [params.id]);
  await query(
    `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id) VALUES ($1,$2,'delete','bill_credit_memo',$3)`,
    [auth.userId, rows[0].company_id, params.id],
  ).catch(() => {});

  return new Response(null, { status: 204 });
}
