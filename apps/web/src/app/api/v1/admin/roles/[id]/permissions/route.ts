import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

type Ctx = { params: { id: string } };

// GET — list permissions assigned to this role
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.module, p.action, p.description
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY p.module, p.action`,
      [params.id]
    );

    return ok(rows);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

// PUT — replace all permissions for this role (full replace)
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return err('Unauthorized', 401);
    if (!auth.isSuperadmin) return err('Forbidden', 403);

    const { permission_ids }: { permission_ids: string[] } = await req.json();

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [params.id]);
      for (const pid of permission_ids ?? []) {
        await client.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [params.id, pid]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return ok({ ok: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
