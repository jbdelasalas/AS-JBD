export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  try {
    const rows = await query<{
      id: string; code: string; name: string; legal_name: string | null;
      tin: string | null; rdo_code: string | null; address: string | null;
      phone: string | null; email: string | null; website: string | null;
      logo: string | null; base_currency: string; allow_negative_inventory: boolean;
    }>(
      `SELECT id, code, name, legal_name, tin, rdo_code, address,
              phone, email, website, logo, base_currency, allow_negative_inventory
         FROM companies WHERE id = $1`,
      [params.id],
    );
    if (!rows[0]) return err('Not found', 404);
    return ok(rows[0]);
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Forbidden', 403);

  try {
    const b = await request.json();
    await query(
      `UPDATE companies SET
         name                      = COALESCE($2, name),
         legal_name                = $3,
         tin                       = $4,
         rdo_code                  = $5,
         address                   = $6,
         phone                     = $7,
         email                     = $8,
         website                   = $9,
         logo                      = $10,
         allow_negative_inventory  = COALESCE($11, allow_negative_inventory)
       WHERE id = $1`,
      [params.id, b.name, b.legal_name ?? null, b.tin ?? null, b.rdo_code ?? null,
       b.address ?? null, b.phone ?? null, b.email ?? null, b.website ?? null, b.logo ?? null,
       b.allow_negative_inventory ?? null],
    );
    return ok({ updated: true });
  } catch (e: unknown) {
    return err((e as Error).message, 500);
  }
}
