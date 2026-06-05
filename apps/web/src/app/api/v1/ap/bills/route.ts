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
    ewt_amount: Number(r.ewt_amount ?? 0),
    total: Number(r.total),
    amount_paid: Number(r.amount_paid),
    balance: Number(r.balance),
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
  let where = `b.company_id = $1`;

  const status = searchParams.get('status');
  const supplierId = searchParams.get('supplier_id');
  const poId = searchParams.get('po_id');

  if (status) { params.push(status); where += ` AND b.status = $${params.length}`; }
  if (supplierId) { params.push(supplierId); where += ` AND b.supplier_id = $${params.length}`; }
  if (poId) { params.push(poId); where += ` AND b.po_id = $${params.length}`; }

  params.push(limit, offset);

  try {
    // Try with ewt_amount; fall back without it if migration pending
    let rows: unknown[];
    try {
      rows = await query(
        `SELECT b.id, b.internal_no, b.bill_no, b.bill_date, b.due_date,
                b.subtotal, b.vat_amount, b.ewt_amount, b.total, b.amount_paid, b.balance, b.status,
                s.name AS supplier_name, s.code AS supplier_code
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
          WHERE ${where}
          ORDER BY b.bill_date DESC, b.internal_no DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
    } catch {
      rows = await query(
        `SELECT b.id, b.internal_no, b.bill_no, b.bill_date, b.due_date,
                b.subtotal, b.vat_amount, 0 AS ewt_amount, b.total, b.amount_paid, b.balance, b.status,
                s.name AS supplier_name, s.code AS supplier_code
           FROM bills b
           JOIN suppliers s ON s.id = b.supplier_id
          WHERE ${where}
          ORDER BY b.bill_date DESC, b.internal_no DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
    }

    const countRows = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM bills b WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return ok({
      data: rows.map((r) => mapRow(r as Record<string, unknown>)),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
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
  if (!lines?.length) return err('Bill must have at least one line', 400);

  const companyId = dto.company_id as string;
  const supplierId = dto.supplier_id as string;
  if (!companyId || !supplierId) return err('company_id and supplier_id are required', 400);
  if (!dto.bill_date || !dto.bill_no) return err('bill_date and bill_no are required', 400);

  const suppliers = await query(
    `SELECT id, payment_terms_days, ewt_rate FROM suppliers WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [supplierId, companyId],
  );
  if (!suppliers[0]) return err('Supplier not found or inactive', 404);
  const supplier = suppliers[0] as Record<string, unknown>;

  // If an EWT tax code is specified, use its rate
  const ewtCodeId = dto.ewt_code_id as string | null ?? null;
  let ewtCodeRate: number | null = null;
  if (ewtCodeId) {
    const tcRows = await query(
      `SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2 AND tax_type = 'ewt' AND is_active = true`,
      [ewtCodeId, companyId],
    );
    if (tcRows[0]) ewtCodeRate = Number((tcRows[0] as Record<string, unknown>).rate_pct);
  }

  // Detect which columns exist so inserts work before and after migration 034
  const colCheckResult = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('ewt_code_id','ewt_amount','ewt_rate','grow_reference_id')
      AND table_name IN ('bills','bill_lines')
  `);
  const existingCols = new Set((colCheckResult as Array<Record<string,unknown>>).map(r => String(r.column_name)));
  const hasEwtCodeId   = existingCols.has('ewt_code_id');
  const hasEwtAmount   = existingCols.has('ewt_amount');
  const hasLineEwtRate = existingCols.has('ewt_rate');
  const hasGrowRef     = existingCols.has('grow_reference_id');

  // Check tagging columns specifically on bill_lines (added by migrate-031)
  const blTagResult = await query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bill_lines'
      AND column_name IN ('branch_id','building_id','cost_center_id')
  `);
  const blTagCols = new Set((blTagResult as Array<Record<string,unknown>>).map(r => String(r.column_name)));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM bills WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const internalNo = `BL-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    // Per-line ewt_code_id may differ; resolve rate from line code if provided
    const lineEwtRateCache = new Map<string, number>();
    if (ewtCodeId && ewtCodeRate !== null) lineEwtRateCache.set(ewtCodeId, ewtCodeRate);

    const mappedLines = await Promise.all((lines as Array<Record<string, unknown>>).map(async (l, idx) => {
      const qty = Number(l.quantity);
      const price = Number(l.unit_price);
      const vatRate = Number(l.vat_rate ?? 12);

      // Resolve per-line EWT rate: per-line code > explicit rate > bill default code > 0
      const lineCodeId = (l.ewt_code_id as string | null) || null;
      let resolvedEwtRate = Number(l.ewt_rate ?? 0);
      if (lineCodeId) {
        if (!lineEwtRateCache.has(lineCodeId)) {
          const tcRow = await query(
            `SELECT rate_pct FROM tax_codes WHERE id = $1 AND company_id = $2 AND is_active = true`,
            [lineCodeId, companyId],
          );
          if (tcRow[0]) lineEwtRateCache.set(lineCodeId, Number((tcRow[0] as Record<string, unknown>).rate_pct));
        }
        resolvedEwtRate = lineEwtRateCache.get(lineCodeId) ?? resolvedEwtRate;
      }
      const ewtRate = resolvedEwtRate;
      const lineSubtotal = parseFloat((qty * price).toFixed(2));
      const lineVat = parseFloat((lineSubtotal * (vatRate / 100)).toFixed(2));
      const lineTotal = parseFloat((lineSubtotal + lineVat).toFixed(2));
      const ewtAmount = parseFloat((lineSubtotal * (ewtRate / 100)).toFixed(2));
      return { ...l, line_no: idx + 1, qty, price, vatRate, ewtRate, lineSubtotal, lineVat, lineTotal, ewtAmount, resolvedEwtCodeId: lineCodeId ?? ewtCodeId ?? null } as Record<string, unknown> & { line_no: number; qty: number; price: number; vatRate: number; ewtRate: number; lineSubtotal: number; lineVat: number; lineTotal: number; ewtAmount: number; resolvedEwtCodeId: string | null; item_id?: unknown; description: unknown; expense_account_id?: unknown };
    }));

    const totSubtotal = mappedLines.reduce((s, l) => s + l.lineSubtotal, 0);
    const totVat = mappedLines.reduce((s, l) => s + l.lineVat, 0);
    const totTotal = mappedLines.reduce((s, l) => s + l.lineTotal, 0);
    const totEwt = mappedLines.reduce((s, l) => s + l.ewtAmount, 0);

    const terms = (dto.payment_terms_days as number) ?? Number(supplier.payment_terms_days) ?? 30;
    let dueDate = dto.due_date as string;
    if (!dueDate) {
      const d = new Date(dto.bill_date as string);
      d.setDate(d.getDate() + terms);
      dueDate = d.toISOString().split('T')[0];
    }

    const netPayable = parseFloat((totTotal - totEwt).toFixed(2));

    // Build bills INSERT dynamically based on which columns exist
    const billCols = [
      'company_id','branch_id','bill_no','internal_no','supplier_id','bill_date','due_date','currency',
      'subtotal','vat_amount','total','amount_paid','balance','status','po_id','created_by',
      'building_id','cost_center_id',
    ];
    const billVals: unknown[] = [
      companyId, dto.branch_id ?? null, dto.bill_no, internalNo, supplierId,
      dto.bill_date, dueDate, 'PHP',
      totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), 0,
      hasEwtAmount ? netPayable.toFixed(2) : totTotal.toFixed(2),
      'draft', dto.po_id ?? null, auth.userId,
      dto.building_id ?? null, dto.cost_center_id ?? null,
    ];
    if (hasGrowRef) { billCols.push('grow_reference_id'); billVals.push(dto.grow_reference_id ?? null); }
    if (hasEwtAmount) { billCols.splice(9, 0, 'ewt_amount'); billVals.splice(9, 0, totEwt.toFixed(2)); }
    if (hasEwtCodeId) { billCols.push('ewt_code_id'); billVals.push(ewtCodeId); }

    const billPlaceholders = billVals.map((_, i) => `$${i + 1}`).join(',');
    const headerRows = await client.query(
      `INSERT INTO bills (${billCols.join(',')}) VALUES (${billPlaceholders}) RETURNING *`,
      billVals,
    );
    const header = headerRows.rows[0];

    for (const l of mappedLines) {
      const lineCols = ['bill_id','line_no','item_id','description','quantity','unit_price','vat_rate','line_subtotal','line_vat','line_total','expense_account_id'];
      const lineVals: unknown[] = [
        header.id, l.line_no, l.item_id ?? null, l.description,
        l.qty, l.price, l.vatRate,
        l.lineSubtotal.toFixed(2), l.lineVat.toFixed(2), l.lineTotal.toFixed(2),
        l.expense_account_id ?? null,
      ];
      if (hasLineEwtRate) {
        lineCols.push('ewt_rate', 'ewt_amount');
        lineVals.push(l.ewtRate, l.ewtAmount.toFixed(2));
      }
      if (blTagCols.has('branch_id')) { lineCols.push('branch_id'); lineVals.push((l as Record<string,unknown>).branch_id ?? null); }
      if (blTagCols.has('building_id')) { lineCols.push('building_id'); lineVals.push((l as Record<string,unknown>).building_id ?? null); }
      if (blTagCols.has('cost_center_id')) { lineCols.push('cost_center_id'); lineVals.push((l as Record<string,unknown>).cost_center_id ?? null); }
      if (hasGrowRef) { lineCols.push('grow_reference_id'); lineVals.push((l as Record<string,unknown>).grow_reference_id ?? null); }
      if (hasEwtCodeId) { lineCols.push('ewt_code_id'); lineVals.push(l.resolvedEwtCodeId); }

      const linePlaceholders = lineVals.map((_, i) => `$${i + 1}`).join(',');
      await client.query(
        `INSERT INTO bill_lines (${lineCols.join(',')}) VALUES (${linePlaceholders})`,
        lineVals,
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'bill', header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT b.*, s.name AS supplier_name, s.code AS supplier_code
         FROM bills b
         JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.id = $1 LIMIT 1`,
      [header.id],
    );
    const billLines = await query(
      `SELECT bl.*, a.name AS account_name
         FROM bill_lines bl
         LEFT JOIN accounts a ON a.id = bl.expense_account_id
        WHERE bl.bill_id = $1
        ORDER BY bl.line_no`,
      [header.id],
    );

    return ok({
      ...mapRow(fullRows[0] as Record<string, unknown>),
      lines: billLines.map((l) => {
        const row = l as Record<string, unknown>;
        return {
          ...row,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          vat_rate: Number(row.vat_rate),
          ewt_rate: Number(row.ewt_rate ?? 0),
          line_subtotal: Number(row.line_subtotal),
          line_vat: Number(row.line_vat),
          line_total: Number(row.line_total),
          ewt_amount: Number(row.ewt_amount ?? 0),
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
