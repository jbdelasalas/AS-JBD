export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Batch/lot numbers for traceability labels.
//
// Uniqueness is enforced by the UNIQUE constraints on dp_label_lots, not by
// application logic — the browser cannot be trusted to hold a counter (two
// stations, cleared site data), and a read-then-write in the API would still
// race. Allocation is one atomic statement; concurrent callers collide on the
// constraint and we retry.

const MAX_RETRIES = 5;

/** "2026-08-25" -> "20260825" */
function compactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * GET — the lots already issued for a pack date, newest first. Lets the page
 * show what has been printed and warn before a hand-typed number collides.
 */
export async function GET(request: NextRequest) {
  try { await requireAuth(request); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const companyId = url.searchParams.get('company_id');
  const packDate = url.searchParams.get('pack_date');
  if (!companyId) return err('company_id is required', 400);
  if (packDate && !isIsoDate(packDate)) return err('pack_date must be YYYY-MM-DD', 400);

  const rows = await query(
    `SELECT l.id, l.lot_no, l.seq, l.pack_date, l.facility, l.copies, l.created_at,
            l.net_weight_kg, l.head_count,
            s.code AS size_code, COALESCE(s.label_name, s.name) AS product
       FROM dp_label_lots l
       LEFT JOIN dp_sizes s ON s.id = l.size_id
      WHERE l.company_id = $1
        AND ($2::date IS NULL OR l.pack_date = $2::date)
      ORDER BY l.pack_date DESC, l.seq DESC
      LIMIT 100`,
    [companyId, packDate || null],
  );
  return ok({ data: rows });
}

/**
 * POST — allocate the next lot number for a pack date, or record a
 * caller-supplied one. Returns 409 if a supplied number is already taken.
 */
export async function POST(request: NextRequest) {
  let auth;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }

  let dto: Record<string, unknown>;
  try { dto = await request.json(); } catch { return err('Invalid request body', 400); }

  const companyId = dto.company_id as string;
  if (!companyId) return err('company_id is required', 400);

  const packDate = dto.pack_date;
  if (!isIsoDate(packDate)) return err('pack_date must be YYYY-MM-DD', 400);

  const sizeId = (dto.size_id as string) || null;
  const facilityId = (dto.facility_id as string) || null;
  // The name is denormalised alongside the id: renaming a facility later must
  // not rewrite what a already-printed sticker says.
  const facility = dto.facility ? String(dto.facility).slice(0, 60) : null;
  const copies = Number(dto.copies);
  const copiesVal = Number.isInteger(copies) && copies > 0 && copies <= 200 ? copies : 1;

  // Actual pack contents. Both optional — offal is sold by weight only — but a
  // supplied value must be sane, since it is printed and travels in the QR.
  let weight: number | null = null;
  if (dto.net_weight_kg !== null && dto.net_weight_kg !== undefined && dto.net_weight_kg !== '') {
    weight = Number(dto.net_weight_kg);
    if (!Number.isFinite(weight) || weight <= 0) return err('net_weight_kg must be a positive number', 400);
  }

  let headCount: number | null = null;
  if (dto.head_count !== null && dto.head_count !== undefined && dto.head_count !== '') {
    headCount = Number(dto.head_count);
    if (!Number.isInteger(headCount) || headCount <= 0) {
      return err('head_count must be a positive whole number', 400);
    }
  }

  // A caller-supplied lot bypasses the counter but not the uniqueness check.
  const supplied = dto.lot_no ? String(dto.lot_no).trim() : null;
  if (supplied) {
    if (supplied.length > 32) return err('lot_no must be 32 characters or fewer', 400);
    try {
      const [row] = await query<{ id: string; lot_no: string; seq: number }>(
        `INSERT INTO dp_label_lots
           (company_id, pack_date, seq, lot_no, size_id, facility_id, facility, copies, net_weight_kg, head_count, created_by)
         VALUES ($1, $2::date, 0, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, lot_no, seq`,
        [companyId, packDate, supplied, sizeId, facilityId, facility, copiesVal, weight, headCount, auth.userId],
      );
      return ok(row, 201);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/unique|duplicate/i.test(msg)) {
        return err(`Lot ${supplied} has already been issued`, 409);
      }
      return err(msg || 'Failed to record lot', 500);
    }
  }

  // Allocate. `seq` and `lot_no` are derived from the current max inside the
  // same statement, so there is no window between reading and writing. If two
  // requests compute the same seq, exactly one INSERT survives the UNIQUE
  // constraint and the other retries against the new max.
  const prefix = compactDate(packDate);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const [row] = await query<{ id: string; lot_no: string; seq: number }>(
        `INSERT INTO dp_label_lots
           (company_id, pack_date, seq, lot_no, size_id, facility_id, facility, copies, net_weight_kg, head_count, created_by)
         SELECT $1, $2::date, next_seq,
                $3 || '-' || lpad(next_seq::text, 2, '0'),
                $4, $5, $6, $7, $8, $9, $10
           FROM (
             SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
               FROM dp_label_lots
              WHERE company_id = $1 AND pack_date = $2::date
           ) AS n
         RETURNING id, lot_no, seq`,
        [companyId, packDate, prefix, sizeId, facilityId, facility, copiesVal, weight, headCount, auth.userId],
      );
      return ok(row, 201);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      // Lost the race — another station took this seq. Recompute and retry.
      if (/unique|duplicate/i.test(msg)) continue;
      return err(msg || 'Failed to allocate lot', 500);
    }
  }

  return err('Could not allocate a lot number — too many concurrent requests. Try again.', 503);
}
