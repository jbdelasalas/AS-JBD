export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(_req); } catch (e) { return e as Response; }
  try {
    const [hdr] = await query(
      `SELECT o.*, s.name AS supplier_name, s.code AS supplier_code
         FROM order_ins o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = $1`, [params.id]);
    if (!hdr) return err('Not found', 404);
    const lines = await query(
      `SELECT l.*, i.name AS item_name, i.sku FROM order_in_lines l JOIN items i ON i.id = l.item_id WHERE l.order_in_id = $1 ORDER BY l.line_no`,
      [params.id]);
    return ok({ ...hdr, lines });
  } catch (e: unknown) { return err((e as Error).message, 500); }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid JSON', 400); }

  const [existing] = await query<{ status: string; company_id: string }>(`SELECT status, company_id FROM order_ins WHERE id = $1`, [params.id]);
  if (!existing) return err('Not found', 404);
  if (existing.status === 'posted' || existing.status === 'voided') return err('Cannot edit a posted/voided order', 400);

  const lines = dto.lines as Record<string, unknown>[] | undefined;
  try {
    const total = lines ? lines.reduce((s, l) => s + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), 0) : undefined;
    await query(
      `UPDATE order_ins SET supplier_id=COALESCE($2,supplier_id), reference_no=COALESCE($3,reference_no),
         transaction_date=COALESCE($4,transaction_date), date_needed=$5, delivery_method=COALESCE($6,delivery_method),
         payment_terms=COALESCE($7,payment_terms), remarks=$8, notes=$9,
         total_amount=COALESCE($10,total_amount)
       WHERE id = $1`,
      [params.id, dto.supplier_id ?? null, dto.reference_no ?? null, dto.transaction_date ?? null,
       dto.date_needed ?? null, dto.delivery_method ?? null, dto.payment_terms ?? null,
       dto.remarks ?? null, dto.notes ?? null, total ?? null],
    );
    if (lines) {
      await query(`DELETE FROM order_in_lines WHERE order_in_id = $1`, [params.id]);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await query(
          `INSERT INTO order_in_lines (order_in_id, line_no, item_id, quantity, uom, unit_price, amount, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [params.id, i + 1, l.item_id, l.quantity, l.uom ?? 'heads', l.unit_price ?? 0,
           Number(l.quantity ?? 0) * Number(l.unit_price ?? 0), l.remarks ?? null],
        );
      }
    }
    await query(`INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id, after_state) VALUES ($1,$2,'update','order_in',$3,$4)`,
      [auth.userId, existing.company_id, params.id, JSON.stringify(dto)]).catch(() => {});
    const [updated] = await query(`SELECT * FROM order_ins WHERE id = $1`, [params.id]);
    return ok(updated);
  } catch (e: unknown) { return err((e as Error).message, 500); }
}
