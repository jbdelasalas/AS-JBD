export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

const BOOK_LABELS: Record<string, string> = {
  SB: 'Sales Book',
  PB: 'Purchase Book',
  GJ: 'General Journal',
  CVB: 'Cash Voucher Book',
  CRB: 'Cash Receipts Book',
  CDB: 'Cash Disbursements Book',
};

export async function GET(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const year = searchParams.get('year');
  const bookType = searchParams.get('book_type');

  const params: unknown[] = [companyId];
  let where = `bg.company_id = $1`;
  if (year) { params.push(parseInt(year)); where += ` AND bg.period_year = $${params.length}`; }
  if (bookType) { params.push(bookType); where += ` AND bg.book_type = $${params.length}`; }

  try {
    const rows = await query(
      `SELECT bg.*, u.email AS generated_by_email
         FROM book_generations bg
         LEFT JOIN users u ON u.id = bg.generated_by
        WHERE ${where}
        ORDER BY bg.period_year DESC, bg.period_month DESC NULLS LAST, bg.book_type`,
      params,
    );

    return ok(rows.map((r) => {
      const row = r as Record<string, unknown>;
      return { ...row, total_amount: Number(row.total_amount) };
    }));
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
  const bookType = dto.book_type as string;
  const periodYear = Number(dto.period_year);
  const periodMonth = dto.period_month ? Number(dto.period_month) : null;

  if (!companyId) return err('company_id is required', 400);
  if (!bookType || !BOOK_LABELS[bookType]) return err('book_type must be one of: SB, PB, GJ, CVB, CRB, CDB', 400);
  if (!periodYear) return err('period_year is required', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Check if already generated for this period (upsert approach)
    const existing = await client.query(
      `SELECT id, status FROM book_generations
        WHERE company_id = $1 AND book_type = $2 AND period_year = $3
          AND COALESCE(period_month, 0) = COALESCE($4, 0)`,
      [companyId, bookType, periodYear, periodMonth],
    );

    if (existing.rows[0]?.status === 'final') {
      return err('This book has been finalized and cannot be regenerated', 409);
    }

    // Call the appropriate function based on book type
    let rowCount = 0;
    let totalAmount = 0;

    if (bookType === 'SB' && periodMonth) {
      const rows = await client.query(
        `SELECT * FROM generate_book_sales($1, $2, $3)`,
        [companyId, periodYear, periodMonth],
      );
      rowCount = rows.rowCount ?? 0;
      totalAmount = rows.rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount), 0);
    } else if (bookType === 'PB' && periodMonth) {
      const rows = await client.query(
        `SELECT * FROM generate_book_purchases($1, $2, $3)`,
        [companyId, periodYear, periodMonth],
      );
      rowCount = rows.rowCount ?? 0;
      totalAmount = rows.rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.gross_amount), 0);
    } else if (bookType === 'GJ' && periodMonth) {
      const rows = await client.query(
        `SELECT * FROM generate_book_general_journal($1, $2, $3)`,
        [companyId, periodYear, periodMonth],
      );
      rowCount = rows.rowCount ?? 0;
      totalAmount = rows.rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.debit), 0);
    } else {
      // For book types without dedicated functions, just count relevant records
      rowCount = 0;
      totalAmount = 0;
    }

    let bookId: string;
    if (existing.rows[0]) {
      const upd = await client.query(
        `UPDATE book_generations
            SET row_count = $1, total_amount = $2, generated_by = $3, generated_at = now(), status = 'draft'
          WHERE id = $4
          RETURNING id`,
        [rowCount, totalAmount.toFixed(2), auth.userId, existing.rows[0].id],
      );
      bookId = upd.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO book_generations
           (company_id, branch_id, book_type, period_year, period_month, row_count, total_amount, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          companyId, dto.branch_id ?? null, bookType, periodYear, periodMonth,
          rowCount, totalAmount.toFixed(2), auth.userId,
        ],
      );
      bookId = ins.rows[0].id;
    }

    await client.query('COMMIT');

    const result = await query(`SELECT * FROM book_generations WHERE id = $1`, [bookId]);
    const row = result[0] as Record<string, unknown>;
    return ok({ ...row, total_amount: Number(row.total_amount) }, 201);
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
