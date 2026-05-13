export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `gr.company_id = $1`;

  const poId = searchParams.get('po_id');
  if (poId) { params.push(poId); where += ` AND gr.po_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT gr.id, gr.grn_no, gr.receipt_date, gr.delivery_no, gr.notes, gr.status,
            po.po_no, s.name AS supplier_name
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.po_id
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where}
      ORDER BY gr.receipt_date DESC, gr.grn_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM goods_receipts gr WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows,
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines?.length) return err('GRN must have at least one line', 400);

  const companyId = dto.company_id as string;
  const poId = dto.po_id as string;
  if (!companyId || !poId) return err('company_id and po_id are required', 400);

  const poRows = await query(
    `SELECT id, status FROM purchase_orders WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [poId, companyId],
  );
  if (!poRows[0]) return err('Purchase order not found', 404);
  const po = poRows[0] as Record<string, unknown>;
  if (!['approved','partial'].includes(po.status as string)) {
    return err(`PO must be approved or partial to receive goods (current: ${po.status})`, 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM goods_receipts WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const grnNo = `GRN-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO goods_receipts
         (company_id, grn_no, po_id, warehouse_id, receipt_date, delivery_no, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8)
       RETURNING *`,
      [
        companyId, grnNo, poId,
        dto.warehouse_id ?? null,
        dto.receipt_date,
        dto.delivery_no ?? null,
        dto.notes ?? null,
        auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as Record<string, unknown>;
      const qtyReceived = Number(l.qty_received);
      if (qtyReceived <= 0) continue;

      await client.query(
        `INSERT INTO goods_receipt_lines (grn_id, po_line_id, line_no, qty_received, unit_cost)
         VALUES ($1,$2,$3,$4,$5)`,
        [header.id, l.po_line_id, i + 1, qtyReceived, Number(l.unit_cost ?? 0)],
      );

      await client.query(
        `UPDATE purchase_order_lines
            SET qty_received = qty_received + $1
          WHERE id = $2`,
        [qtyReceived, l.po_line_id],
      );
    }

    // Update PO status based on receipt totals
    await client.query(
      `UPDATE purchase_orders po
          SET status = CASE
            WHEN (SELECT SUM(pol.qty_received) FROM purchase_order_lines pol WHERE pol.po_id = po.id)
                  >= (SELECT SUM(pol.quantity) FROM purchase_order_lines pol WHERE pol.po_id = po.id)
            THEN 'received'
            ELSE 'partial'
          END,
          updated_at = now()
        WHERE id = $1`,
      [poId],
    );

    await client.query(
      `UPDATE goods_receipts SET posted_at = now() WHERE id = $1`,
      [header.id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'goods_receipt', header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT gr.*, po.po_no, s.name AS supplier_name
         FROM goods_receipts gr
         JOIN purchase_orders po ON po.id = gr.po_id
         JOIN suppliers s ON s.id = po.supplier_id
        WHERE gr.id = $1 LIMIT 1`,
      [header.id],
    );
    const grnLines = await query(
      `SELECT grl.*, pol.description, pol.unit_price
         FROM goods_receipt_lines grl
         JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
        WHERE grl.grn_id = $1
        ORDER BY grl.line_no`,
      [header.id],
    );

    return ok({ ...fullRows[0], lines: grnLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
