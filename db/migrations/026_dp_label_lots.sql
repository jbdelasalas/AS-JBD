-- 026_dp_label_lots.sql
-- Server-allocated batch/lot numbers for dressed-chicken traceability labels.
--
-- The label printer previously counted lots in the browser's localStorage. That
-- cannot guarantee uniqueness: two stations printing on the same day both start
-- at -01, and clearing site data silently restarts the sequence. A lot number
-- that repeats is worse than useless for traceability — it maps one code to two
-- different batches.
--
-- So the sequence moves to the database, where a UNIQUE constraint makes a
-- duplicate impossible rather than merely unlikely. Allocation is a single
-- INSERT ... SELECT max+1 guarded by that constraint: concurrent callers race,
-- the loser hits the constraint, and the API retries. No advisory locks, no
-- read-modify-write window.
--
-- Scope of uniqueness is (company, pack date). Lots are human-read off a
-- sticker, so the number stays short — the date already carries the rest of the
-- context.

CREATE TABLE IF NOT EXISTS dp_label_lots (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pack_date   date NOT NULL,
  seq         integer NOT NULL,                 -- 1, 2, 3 … within the pack date
  lot_no      varchar(32) NOT NULL,             -- rendered form, e.g. 20260825-07
  size_id     uuid REFERENCES dp_sizes(id) ON DELETE SET NULL,
  facility    varchar(60),                      -- what was printed on the label
  copies      integer NOT NULL DEFAULT 1,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- The two guarantees. The first makes the counter race-proof; the second
  -- means a lot number can never be handed out twice, however it was produced
  -- (allocated, typed by hand, or imported).
  UNIQUE (company_id, pack_date, seq),
  UNIQUE (company_id, lot_no)
);

CREATE INDEX IF NOT EXISTS dp_label_lots_company_date_idx
  ON dp_label_lots (company_id, pack_date DESC, seq DESC);

COMMENT ON TABLE dp_label_lots IS
  'Issued label lot numbers. The UNIQUE constraints are the uniqueness guarantee; the API retries on conflict.';
COMMENT ON COLUMN dp_label_lots.seq IS
  'Per (company, pack_date) counter. Gaps are expected and fine — an allocated lot that was never printed still burns its number.';

-- ============================================================================
-- FACILITIES — the managed brand/facility list behind the label dropdown
-- ============================================================================
--
-- The facility name is printed on every sticker and encoded in the QR, so it is
-- reference data, not a free-text field: typing it per station invites "AFCC
-- Dressing Plant", "AFCC dressing plant" and "AFCC DP" to all appear on stock
-- from the same plant. Managed under Administration -> Master Data.

CREATE TABLE IF NOT EXISTS dp_facilities (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        varchar(60) NOT NULL,       -- 60 = what fits a label; keep in sync with the page
  address     varchar(200),               -- not printed; for the plant register
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS dp_facilities_company_idx
  ON dp_facilities (company_id, is_active, name);

-- At most one default per company, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS dp_facilities_one_default_idx
  ON dp_facilities (company_id) WHERE is_default;

COMMENT ON TABLE dp_facilities IS
  'Brand/facility names printed on traceability labels. Managed in Administration -> Master Data.';

-- Link issued lots to the facility they were printed under. Nullable: lots
-- issued before this migration have only the free-text facility string.
ALTER TABLE dp_label_lots ADD COLUMN IF NOT EXISTS facility_id uuid
  REFERENCES dp_facilities(id) ON DELETE SET NULL;

-- Actual pack contents, printed on the sticker and kept with the lot record.
-- Nullable because not every product is sold by head (offal is weight-only).
ALTER TABLE dp_label_lots ADD COLUMN IF NOT EXISTS net_weight_kg numeric(10, 3);
ALTER TABLE dp_label_lots ADD COLUMN IF NOT EXISTS head_count    integer;

-- ADD CONSTRAINT has no IF NOT EXISTS, so guard it to keep the file re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dp_label_lots_weight_positive') THEN
    ALTER TABLE dp_label_lots
      ADD CONSTRAINT dp_label_lots_weight_positive
      CHECK (net_weight_kg IS NULL OR net_weight_kg > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dp_label_lots_heads_positive') THEN
    ALTER TABLE dp_label_lots
      ADD CONSTRAINT dp_label_lots_heads_positive
      CHECK (head_count IS NULL OR head_count > 0);
  END IF;
END $$;

COMMENT ON COLUMN dp_label_lots.net_weight_kg IS
  'Actual net weight of the pack this label went on, as printed.';
COMMENT ON COLUMN dp_label_lots.head_count IS
  'Actual head count for the pack; NULL for weight-only products such as offal.';
