export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  void auth;

  try {
    const rows = await query(
      `SELECT bg.*, u.email AS generated_by_email
         FROM book_generations bg
         LEFT JOIN users u ON u.id = bg.generated_by
        WHERE bg.id = $1`,
      [params.id],
    );
    if (!rows[0]) return err('Book generation not found', 404);

    const row = rows[0] as Record<string, unknown>;

    // Return the book data — in a full impl this would fetch the actual rows
    // from the generation function; here we return the metadata
    return ok({ ...row, total_amount: Number(row.total_amount) });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

// PATCH — finalize a book (locks it from regeneration)
export async function PATCH(request: NextRequest, { params }: Ctx) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  if (dto.action !== 'finalize') return err('action must be "finalize"', 400);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status, company_id FROM book_generations WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (!existing.rows[0]) return err('Book generation not found', 404);
    if (existing.rows[0].status === 'final') return err('Already finalized', 409);

    await client.query(
      `UPDATE book_generations
          SET status = 'final', finalized_by = $1, finalized_at = now()
        WHERE id = $2`,
      [auth.userId, params.id],
    );

    await client.query('COMMIT');

    const result = await query(`SELECT * FROM book_generations WHERE id = $1`, [params.id]);
    const row = result[0] as Record<string, unknown>;
    return ok({ ...row, total_amount: Number(row.total_amount) });
  } catch (e) {
    await client.query('ROLLBACK');
    return err((e as Error).message, 500);
  } finally {
    client.release();
  }
}
