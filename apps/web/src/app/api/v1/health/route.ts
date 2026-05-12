export const dynamic = 'force-dynamic';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

export async function GET() {
  try {
    await query('SELECT 1');
    return ok({ status: 'ok', db: 'connected' });
  } catch (e) {
    return err(`db error: ${(e as Error).message}`, 503);
  }
}
