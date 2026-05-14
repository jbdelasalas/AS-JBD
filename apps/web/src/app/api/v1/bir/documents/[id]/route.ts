export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

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

export async function GET(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  try {
    const docs = await query(
      `SELECT d.* FROM issued_documents d WHERE d.id = $1`,
      [params.id],
    );
    if (!docs[0]) return err('Document not found', 404);

    const lines = await query(
      `SELECT * FROM issued_document_lines WHERE document_id = $1 ORDER BY line_no`,
      [params.id],
    );
    const scPwd = await query(
      `SELECT * FROM sc_pwd_transactions WHERE document_id = $1`,
      [params.id],
    );

    return ok({
      ...mapDoc(docs[0] as Record<string, unknown>),
      lines: lines.map((l) => {
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
      sc_pwd_transactions: scPwd.map((t) => {
        const row = t as Record<string, unknown>;
        return {
          ...row,
          gross_amount: Number(row.gross_amount),
          discount_rate: Number(row.discount_rate),
          discount_amount: Number(row.discount_amount),
          vat_exemption_amount: Number(row.vat_exemption_amount),
          net_amount: Number(row.net_amount),
        };
      }),
    });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

// PATCH — void a document
export async function PATCH(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  if (!dto.void_reason) return err('void_reason is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const docs = await client.query(
      `SELECT id, status, company_id FROM issued_documents WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (!docs.rows[0]) return err('Document not found', 404);
    if (docs.rows[0].status !== 'active') return err('Only active documents can be voided', 400);

    await client.query(
      `UPDATE issued_documents
          SET status = 'void', void_reason = $1, voided_at = now(), voided_by = $2, updated_at = now()
        WHERE id = $3`,
      [dto.void_reason, auth.userId, params.id],
    );

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'void', 'issued_document', $3)`,
      [auth.userId, docs.rows[0].company_id, params.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const updated = await query(`SELECT * FROM issued_documents WHERE id = $1`, [params.id]);
    return ok(mapDoc(updated[0] as Record<string, unknown>));
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
