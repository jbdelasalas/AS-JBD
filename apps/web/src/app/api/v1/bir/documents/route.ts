export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

function mapDoc(r: Record<string, unknown>) {
  return {
    ...r,
    total_amount: Number(r.total_amount),
    vatable_amount: Number(r.vatable_amount),
    vat_exempt_amount: Number(r.vat_exempt_amount),
    zero_rated_amount: Number(r.zero_rated_amount),
    vat_amount: Number(r.vat_amount),
    sc_discount: Number(r.sc_discount),
    pwd_discount: Number(r.pwd_discount),
    total_discount: Number(r.total_discount),
    net_amount: Number(r.net_amount),
  };
}

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `d.company_id = $1`;

  const status = searchParams.get('status');
  const docType = searchParams.get('document_type');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');

  if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
  if (docType) { params.push(docType); where += ` AND d.document_type = $${params.length}`; }
  if (dateFrom) { params.push(dateFrom); where += ` AND d.transaction_date >= $${params.length}`; }
  if (dateTo) { params.push(dateTo); where += ` AND d.transaction_date <= $${params.length}`; }

  params.push(limit, offset);

  try {
    const rows = await query(
      `SELECT d.id, d.document_type, d.document_no, d.transaction_date,
              d.customer_name, d.customer_tin, d.is_vat_registered,
              d.total_amount, d.vat_amount, d.net_amount,
              d.sc_discount, d.pwd_discount, d.total_discount,
              d.status, d.created_at
         FROM issued_documents d
        WHERE ${where}
        ORDER BY d.transaction_date DESC, d.document_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await query<{ c: number }>(
      `SELECT count(*)::int AS c FROM issued_documents d WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return ok({
      data: rows.map((r) => mapDoc(r as Record<string, unknown>)),
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
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);
  if (!dto.document_type) return err('document_type is required', 400);
  if (!dto.transaction_date) return err('transaction_date is required', 400);
  if (!dto.customer_name) return err('customer_name is required', 400);

  const lines = (dto.lines as Array<Record<string, unknown>>) ?? [];
  if (!lines.length) return err('At least one line is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Generate document number if not provided
    let documentNo = dto.document_no as string;
    if (!documentNo) {
      const seq = await client.query(
        `SELECT COUNT(*)::int AS c FROM issued_documents WHERE company_id = $1`,
        [companyId],
      );
      documentNo = `${dto.document_type}-${new Date().getFullYear()}-${String(seq.rows[0].c + 1).padStart(7, '0')}`;
    }

    // Compute totals from lines
    let vatableAmt = 0, vatExemptAmt = 0, zeroRatedAmt = 0, vatAmt = 0, totalAmt = 0;
    const mappedLines = lines.map((l, idx) => {
      const qty = Number(l.quantity ?? 1);
      const price = Number(l.unit_price ?? 0);
      const discAmt = Number(l.discount_amount ?? 0);
      const lVatable = parseFloat((Number(l.vatable_amount ?? 0)).toFixed(2));
      const lExempt = parseFloat((Number(l.vat_exempt_amount ?? 0)).toFixed(2));
      const lZero = parseFloat((Number(l.zero_rated_amount ?? 0)).toFixed(2));
      const lVat = parseFloat((Number(l.vat_amount ?? 0)).toFixed(2));
      const lTotal = parseFloat((Number(l.line_total ?? qty * price - discAmt)).toFixed(2));
      vatableAmt += lVatable;
      vatExemptAmt += lExempt;
      zeroRatedAmt += lZero;
      vatAmt += lVat;
      totalAmt += lTotal;
      return { orig: l, line_no: idx + 1, qty, price, discAmt, lVatable, lExempt, lZero, lVat, lTotal };
    });

    const scDiscount = Number(dto.sc_discount ?? 0);
    const pwdDiscount = Number(dto.pwd_discount ?? 0);
    const totalDiscount = scDiscount + pwdDiscount + lines.reduce((s, l) => s + Number(l.discount_amount ?? 0), 0);
    const netAmount = parseFloat((totalAmt - scDiscount - pwdDiscount).toFixed(2));
    totalAmt = parseFloat(totalAmt.toFixed(2));

    const docRows = await client.query(
      `INSERT INTO issued_documents
         (company_id, branch_id, document_type, series_id, document_no, transaction_date,
          customer_id, customer_tin, customer_name, customer_address, is_vat_registered,
          sc_pwd_id, total_amount, vatable_amount, vat_exempt_amount, zero_rated_amount,
          vat_amount, sc_discount, pwd_discount, total_discount, net_amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'active',$22)
       RETURNING *`,
      [
        companyId, dto.branch_id ?? null, dto.document_type, dto.series_id ?? null,
        documentNo, dto.transaction_date,
        dto.customer_id ?? null, dto.customer_tin ?? null, dto.customer_name,
        dto.customer_address ?? null, dto.is_vat_registered ?? false,
        dto.sc_pwd_id ?? null, totalAmt.toFixed(2), vatableAmt.toFixed(2),
        vatExemptAmt.toFixed(2), zeroRatedAmt.toFixed(2), vatAmt.toFixed(2),
        scDiscount.toFixed(2), pwdDiscount.toFixed(2), totalDiscount.toFixed(2),
        netAmount.toFixed(2), auth.userId,
      ],
    );
    const docHeader = docRows.rows[0];

    for (const l of mappedLines) {
      await client.query(
        `INSERT INTO issued_document_lines
           (document_id, line_no, description, quantity, unit_price, discount_amount,
            vatable_amount, vat_exempt_amount, zero_rated_amount, vat_amount, line_total,
            item_id, tax_code_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          docHeader.id, l.line_no, l.orig.description, l.qty, l.price, l.discAmt,
          l.lVatable, l.lExempt, l.lZero, l.lVat, l.lTotal,
          l.orig.item_id ?? null, l.orig.tax_code_id ?? null,
        ],
      );
    }

    // If SC/PWD, record transaction
    if (dto.sc_pwd_type && dto.sc_pwd_id_number) {
      await client.query(
        `INSERT INTO sc_pwd_transactions
           (company_id, branch_id, document_id, sc_pwd_type, id_number, beneficiary_name,
            osca_number, gross_amount, discount_rate, discount_amount, vat_exemption_amount,
            net_amount, transaction_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          companyId, dto.branch_id ?? null, docHeader.id,
          dto.sc_pwd_type, dto.sc_pwd_id_number, dto.customer_name,
          dto.osca_number ?? null, totalAmt.toFixed(2),
          dto.discount_rate ?? 0.20,
          (scDiscount + pwdDiscount).toFixed(2),
          vatAmt.toFixed(2), netAmount.toFixed(2),
          dto.transaction_date, auth.userId,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'issued_document', docHeader.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const full = await query(
      `SELECT d.* FROM issued_documents d WHERE d.id = $1`,
      [docHeader.id],
    );
    const docLines = await query(
      `SELECT * FROM issued_document_lines WHERE document_id = $1 ORDER BY line_no`,
      [docHeader.id],
    );

    return ok({
      ...mapDoc(full[0] as Record<string, unknown>),
      lines: docLines.map((l) => {
        const row = l as Record<string, unknown>;
        return {
          ...row,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          discount_amount: Number(row.discount_amount),
          vatable_amount: Number(row.vatable_amount),
          vat_exempt_amount: Number(row.vat_exempt_amount),
          zero_rated_amount: Number(row.zero_rated_amount),
          vat_amount: Number(row.vat_amount),
          line_total: Number(row.line_total),
        };
      }),
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
