export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

// Reconcile sales_tally_sheets to the schema the application code expects.
// Some databases got the older "doc_no / transfer_date" shape (from
// run-migrations) instead of the "tally_no / tally_date" shape the code uses,
// causing: column "tally_no" of relation "sales_tally_sheets" does not exist.
// These steps are all idempotent (ADD COLUMN IF NOT EXISTS + guarded backfills).
export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const steps: [string, string][] = [
    // ── sales_tally_sheets: add every column the code references ──────────────
    ['sales_tally_sheets.tally_no',          `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS tally_no          varchar(50)`],
    ['sales_tally_sheets.tally_date',        `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS tally_date        date`],
    ['sales_tally_sheets.delivery_date',     `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS delivery_date     date`],
    ['sales_tally_sheets.customer_name',     `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS customer_name     text`],
    ['sales_tally_sheets.allocation_id',     `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS allocation_id     uuid REFERENCES order_allocations(id)`],
    ['sales_tally_sheets.reference',         `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS reference         text`],
    ['sales_tally_sheets.notes',             `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS notes             text`],
    ['sales_tally_sheets.status',            `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS status            varchar(20) NOT NULL DEFAULT 'draft'`],
    ['sales_tally_sheets.branch_id',         `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES branches(id)`],
    ['sales_tally_sheets.building_id',       `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS building_id       uuid REFERENCES farm_buildings(id)`],
    ['sales_tally_sheets.cost_center_id',    `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS cost_center_id    uuid REFERENCES cost_centers(id)`],
    ['sales_tally_sheets.grow_reference_id', `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['sales_tally_sheets.so_id',             `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS so_id             uuid REFERENCES sales_orders(id)`],
    ['sales_tally_sheets.dr_id',             `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS dr_id             uuid REFERENCES delivery_receipts(id)`],
    ['sales_tally_sheets.poultry_tally_id',  `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS poultry_tally_id  uuid REFERENCES tally_sheets(id)`],
    ['sales_tally_sheets.created_by',        `ALTER TABLE sales_tally_sheets ADD COLUMN IF NOT EXISTS created_by        uuid REFERENCES users(id)`],

    // ── Backfill the new columns from the old shape, where present ───────────
    // tally_no <- doc_no (only if old column exists and new value is null)
    ['backfill tally_no from doc_no', `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='sales_tally_sheets' AND column_name='doc_no') THEN
          UPDATE sales_tally_sheets SET tally_no = doc_no WHERE tally_no IS NULL;
        END IF;
      END $$;`],
    // tally_date <- transfer_date (only if old column exists and new value is null)
    ['backfill tally_date from transfer_date', `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='sales_tally_sheets' AND column_name='transfer_date') THEN
          UPDATE sales_tally_sheets SET tally_date = transfer_date WHERE tally_date IS NULL;
        END IF;
      END $$;`],
    // Any remaining null tally_date -> created_at::date (NOT NULL safety)
    ['backfill tally_date from created_at', `UPDATE sales_tally_sheets SET tally_date = created_at::date WHERE tally_date IS NULL`],

    // Old-shape NOT NULL columns (doc_no / transfer_date) would block inserts
    // that the code makes via tally_no / tally_date. Drop their NOT NULL.
    ['drop NOT NULL on doc_no', `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='sales_tally_sheets' AND column_name='doc_no') THEN
          ALTER TABLE sales_tally_sheets ALTER COLUMN doc_no DROP NOT NULL;
        END IF;
      END $$;`],
    ['drop NOT NULL on transfer_date', `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='sales_tally_sheets' AND column_name='transfer_date') THEN
          ALTER TABLE sales_tally_sheets ALTER COLUMN transfer_date DROP NOT NULL;
        END IF;
      END $$;`],

    // ── sales_tally_lines: ensure expected columns exist ────────────────────
    // The old shape used sales_tally_id as the FK; the code uses tally_id.
    ['sales_tally_lines.tally_id',           `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS tally_id           uuid REFERENCES sales_tally_sheets(id) ON DELETE CASCADE`],
    ['backfill tally_id from sales_tally_id', `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='sales_tally_lines' AND column_name='sales_tally_id') THEN
          UPDATE sales_tally_lines SET tally_id = sales_tally_id WHERE tally_id IS NULL;
          ALTER TABLE sales_tally_lines ALTER COLUMN sales_tally_id DROP NOT NULL;
        END IF;
      END $$;`],
    ['sales_tally_lines.allocation_line_id', `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS allocation_line_id uuid REFERENCES order_allocation_lines(id)`],
    ['sales_tally_lines.item_id',            `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS item_id            uuid REFERENCES items(id)`],
    ['sales_tally_lines.item_id nullable',   `ALTER TABLE sales_tally_lines ALTER COLUMN item_id DROP NOT NULL`],
    ['sales_tally_lines.description',        `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS description        text NOT NULL DEFAULT ''`],
    ['sales_tally_lines.qty_allocated',      `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS qty_allocated      numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.allocation_unit',    `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS allocation_unit    varchar(20) NOT NULL DEFAULT 'Pcs'`],
    ['sales_tally_lines.actual_qty',         `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS actual_qty         numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.actual_weight_kgs',  `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS actual_weight_kgs  numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.unit_price',         `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS unit_price         numeric(14,4) NOT NULL DEFAULT 0`],
    ['sales_tally_lines.remarks',            `ALTER TABLE sales_tally_lines ADD COLUMN IF NOT EXISTS remarks            text`],

    // ── items: kg conversion factors for Bag/Pcs → Kg on allocations ─────────
    ['items.kg_per_bag', `ALTER TABLE items ADD COLUMN IF NOT EXISTS kg_per_bag numeric(14,4)`],
    ['items.kg_per_pcs', `ALTER TABLE items ADD COLUMN IF NOT EXISTS kg_per_pcs numeric(14,4)`],
  ];

  const results: string[] = [];
  for (const [label, sql] of steps) {
    try {
      await query(sql);
      results.push(`ok: ${label}`);
    } catch (e) {
      results.push(`err: ${label} — ${(e as Error).message}`);
    }
  }

  return ok({ results });
}
