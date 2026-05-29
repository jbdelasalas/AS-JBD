export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapRow(r: Record<string, unknown>) {
  return {
    ...r,
    subtotal: Number(r.subtotal),
    vat_amount: Number(r.vat_amount),
    total: Number(r.total),
  };
}

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
  let where = `po.company_id = $1`;

  const status = searchParams.get('status');
  const supplierId = searchParams.get('supplier_id');

  if (status) { params.push(status); where += ` AND po.status = $${params.length}`; }
  if (supplierId) { params.push(supplierId); where += ` AND po.supplier_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT po.id, po.po_no, po.po_date, po.expected_date, po.reference,
            po.subtotal, po.vat_amount, po.total, po.status,
            s.name AS supplier_name, s.code AS supplier_code
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
      WHERE ${where}
      ORDER BY po.po_date DESC, po.po_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM purchase_orders po WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows.map((r) => mapRow(r as Record<string, unknown>)),
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
  if (!lines?.length) return err('PO must have at least one line', 400);

  const companyId = dto.company_id as string;
  const supplierId = dto.supplier_id as string;
  if (!companyId || !supplierId) return err('company_id and supplier_id are required', 400);

  const suppliers = await query(
    `SELECT id FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [supplierId, companyId],
  );
  if (!suppliers[0]) return err('Supplier not found or inactive', 404);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM purchase_orders WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const poNo = `PO-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const mappedLines = (lines as Array<Record<string, unknown>>).map((l, idx) => {
      const qty = Number(l.quantity);
      const price = Number(l.unit_price);
      const vatRate = Number(l.vat_rate ?? 12);
      const lineSubtotal = parseFloat((qty * price).toFixed(2));
      const lineVat = parseFloat((lineSubtotal * (vatRate / 100)).toFixed(2));
      const lineTotal = parseFloat((lineSubtotal + lineVat).toFixed(2));
      return { ...l, line_no: idx + 1, qty, price, vatRate, lineSubtotal, lineVat, lineTotal } as Record<string, unknown> & { line_no: number; qty: number; price: number; vatRate: number; lineSubtotal: number; lineVat: number; lineTotal: number; item_id?: unknown; description: unknown };
    });

    const totSubtotal = mappedLines.reduce((s, l) => s + l.lineSubtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.lineVat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.lineTotal, 0);

    const headerRows = await client.query(
      `INSERT INTO purchase_orders
         (company_id, branch_id, po_no, supplier_id, po_date, expected_date, reference,
          subtotal, vat_amount, total, status, created_by,
          building_id, cost_center_id, grow_reference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14)
       RETURNING *`,
      [
        companyId, dto.branch_id ?? null, poNo, supplierId,
        dto.po_date, dto.expected_date ?? null, dto.reference ?? null,
        totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2),
        auth.userId,
        dto.building_id ?? null, dto.cost_center_id ?? null, dto.grow_reference_id ?? null,
      ],
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO purchase_order_lines
           (po_id, line_no, item_id, description, quantity, qty_received, unit_price, vat_rate, line_total, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9)`,
        [
          header.id, l.line_no, l.item_id ?? null, l.description,
          l.qty, l.price, l.vatRate, l.lineTotal.toFixed(2),
          (l as Record<string,unknown>).grow_reference_id ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'purchase_order', header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT po.*, s.name AS supplier_name, s.code AS supplier_code
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.id = $1 LIMIT 1`,
      [header.id],
    );
    const poLines = await query(
      `SELECT pol.*, i.sku AS item_sku, i.name AS item_name
         FROM purchase_order_lines pol
         LEFT JOIN items i ON i.id = pol.item_id
        WHERE pol.po_id = $1
        ORDER BY pol.line_no`,
      [header.id],
    );

    return ok({
      ...mapRow(fullRows[0] as Record<string, unknown>),
      lines: poLines.map((l) => {
        const row = l as Record<string, unknown>;
        return {
          ...row,
          quantity: Number(row.quantity),
          qty_received: Number(row.qty_received),
          unit_price: Number(row.unit_price),
          vat_rate: Number(row.vat_rate),
          line_total: Number(row.line_total),
        };
      }),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
