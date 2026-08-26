-- 025_dp_label_classes.sql
-- Product classifications for dressed-chicken traceability labels.
--
-- The label printer (Dressing Plant -> Labels) needs the plant's full sell-side
-- classification list: weight-banded Class-A, the no-liver (NL) variants, the
-- assorted/C/cut-up classes, and every offal & by-product line.
--
-- These live in dp_sizes, the module's existing managed size list, so a company
-- can edit them in one place and Production Detail sees the same vocabulary.
-- Two things dp_sizes did not have yet and the label list needs:
--
--   class_group  -- the optgroup heading the operator picks under
--   label_name   -- what prints on the sticker, when it differs from `name`
--
-- `code` stays the short operator-facing token ("0.6", "Gizzard"); `label_name`
-- carries the expanded form ("Fresh Chilled Class-A 0.6 kg") that goes on the
-- label and into the QR payload, because "0.6" alone is not a traceable
-- description once the sticker leaves the plant.

-- ============================================================================
-- TABLE (defensive: dp_sizes is created by the dressing-plant module bootstrap)
-- ============================================================================

CREATE TABLE IF NOT EXISTS dp_sizes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        varchar(40) NOT NULL,
  name        varchar(150) NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

ALTER TABLE dp_sizes ADD COLUMN IF NOT EXISTS class_group varchar(60);
ALTER TABLE dp_sizes ADD COLUMN IF NOT EXISTS label_name  varchar(150);

-- Widen the pre-existing columns. An installation created before this migration
-- has code varchar(20) / name varchar(60), which the classification list below
-- overflows ("SQUABS (0.5 & below)" is 20, "Fresh Chilled Class Assorted" is 28)
-- — the CREATE TABLE above only governs a fresh install, so existing tables must
-- be widened explicitly or the seed fails with "value too long".
-- Widening a varchar is a metadata-only change: no table rewrite, no data loss.
ALTER TABLE dp_sizes ALTER COLUMN code TYPE varchar(40);
ALTER TABLE dp_sizes ALTER COLUMN name TYPE varchar(150);

-- The seed's ON CONFLICT ... DO UPDATE fires row triggers, and dp_sizes may
-- predate the module's updated_at convention.
ALTER TABLE dp_sizes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN dp_sizes.class_group IS
  'Optgroup heading for the label classification dropdown; NULL for plain sizes.';
COMMENT ON COLUMN dp_sizes.label_name IS
  'Expanded name printed on the label and encoded in the QR; falls back to name.';

-- Grouped lookups drive the label dropdown.
CREATE INDEX IF NOT EXISTS dp_sizes_company_group_idx
  ON dp_sizes (company_id, class_group, sort_order);

-- ============================================================================
-- SEED — the 46 classifications, for every existing company
-- ============================================================================
--
-- sort_order is banded per group (100s = Squabs, 200s = Class-A, ...) so new
-- entries can be slotted in later without renumbering the whole list.

INSERT INTO dp_sizes (company_id, code, name, label_name, class_group, sort_order)
SELECT c.id, v.code, v.name, v.label_name, v.class_group, v.sort_order
FROM companies c
CROSS JOIN (VALUES
  -- Squabs -------------------------------------------------------------------
  ('SQUABS (0.5 & below)', 'Squabs (0.5 kg & below)',      'Squabs (0.5 kg & below)',            'Squabs',                        100),

  -- Fresh Chilled Class-A, by weight band (kg) ---------------------------------
  ('0.6',  'Class-A 0.6 kg',  'Fresh Chilled Class-A 0.6 kg',  'Fresh Chilled Class-A (kg)', 200),
  ('0.7',  'Class-A 0.7 kg',  'Fresh Chilled Class-A 0.7 kg',  'Fresh Chilled Class-A (kg)', 201),
  ('0.8',  'Class-A 0.8 kg',  'Fresh Chilled Class-A 0.8 kg',  'Fresh Chilled Class-A (kg)', 202),
  ('0.9',  'Class-A 0.9 kg',  'Fresh Chilled Class-A 0.9 kg',  'Fresh Chilled Class-A (kg)', 203),
  ('1.0',  'Class-A 1.0 kg',  'Fresh Chilled Class-A 1.0 kg',  'Fresh Chilled Class-A (kg)', 204),
  ('1.1',  'Class-A 1.1 kg',  'Fresh Chilled Class-A 1.1 kg',  'Fresh Chilled Class-A (kg)', 205),
  ('1.2',  'Class-A 1.2 kg',  'Fresh Chilled Class-A 1.2 kg',  'Fresh Chilled Class-A (kg)', 206),
  ('1.3',  'Class-A 1.3 kg',  'Fresh Chilled Class-A 1.3 kg',  'Fresh Chilled Class-A (kg)', 207),
  ('1.4',  'Class-A 1.4 kg',  'Fresh Chilled Class-A 1.4 kg',  'Fresh Chilled Class-A (kg)', 208),
  ('1.5',  'Class-A 1.5 kg',  'Fresh Chilled Class-A 1.5 kg',  'Fresh Chilled Class-A (kg)', 209),
  ('1.6',  'Class-A 1.6 kg',  'Fresh Chilled Class-A 1.6 kg',  'Fresh Chilled Class-A (kg)', 210),
  ('1.7',  'Class-A 1.7 kg',  'Fresh Chilled Class-A 1.7 kg',  'Fresh Chilled Class-A (kg)', 211),
  ('1.8',  'Class-A 1.8 kg',  'Fresh Chilled Class-A 1.8 kg',  'Fresh Chilled Class-A (kg)', 212),
  ('1.9',  'Class-A 1.9 kg',  'Fresh Chilled Class-A 1.9 kg',  'Fresh Chilled Class-A (kg)', 213),
  ('2.0',  'Class-A 2.0 kg',  'Fresh Chilled Class-A 2.0 kg',  'Fresh Chilled Class-A (kg)', 214),
  ('Oversized', 'Class-A Oversized', 'Fresh Chilled Class-A Oversized', 'Fresh Chilled Class-A (kg)', 215),

  -- Fresh Chilled Class-A NL (no liver), by weight band (kg) -------------------
  ('0.7-NL', 'Class-A NL 0.7 kg', 'Fresh Chilled Class-A NL 0.7 kg', 'Fresh Chilled Class-A NL (kg)', 300),
  ('0.8-NL', 'Class-A NL 0.8 kg', 'Fresh Chilled Class-A NL 0.8 kg', 'Fresh Chilled Class-A NL (kg)', 301),
  ('0.9-NL', 'Class-A NL 0.9 kg', 'Fresh Chilled Class-A NL 0.9 kg', 'Fresh Chilled Class-A NL (kg)', 302),
  ('1.0-NL', 'Class-A NL 1.0 kg', 'Fresh Chilled Class-A NL 1.0 kg', 'Fresh Chilled Class-A NL (kg)', 303),
  ('1.1-NL', 'Class-A NL 1.1 kg', 'Fresh Chilled Class-A NL 1.1 kg', 'Fresh Chilled Class-A NL (kg)', 304),
  ('1.2-NL', 'Class-A NL 1.2 kg', 'Fresh Chilled Class-A NL 1.2 kg', 'Fresh Chilled Class-A NL (kg)', 305),
  ('1.3-NL', 'Class-A NL 1.3 kg', 'Fresh Chilled Class-A NL 1.3 kg', 'Fresh Chilled Class-A NL (kg)', 306),
  ('1.4-NL', 'Class-A NL 1.4 kg', 'Fresh Chilled Class-A NL 1.4 kg', 'Fresh Chilled Class-A NL (kg)', 307),
  ('NL Oversized', 'Class-A NL Oversized', 'Fresh Chilled Class-A NL Oversized', 'Fresh Chilled Class-A NL (kg)', 308),

  -- Other classes --------------------------------------------------------------
  ('Fresh Chilled Class Assorted', 'Class Assorted', 'Fresh Chilled Class Assorted', 'Other classes', 400),
  ('Fresh Chilled Class-C',        'Class-C',        'Fresh Chilled Class-C',        'Other classes', 401),
  ('Cut ups',                      'Cut Ups',        'Cut Ups',                      'Other classes', 402),

  -- Offal & by-products ---------------------------------------------------------
  ('Good liver',       'Good Liver',       'Good Liver',       'Offal & by-products', 500),
  ('Gizzard',          'Gizzard',          'Gizzard',          'Offal & by-products', 501),
  ('Good Feet',        'Good Feet',        'Good Feet',        'Offal & by-products', 502),
  ('Trimmed Feet',     'Trimmed Feet',     'Trimmed Feet',     'Offal & by-products', 503),
  ('Heads',            'Heads',            'Heads',            'Offal & by-products', 504),
  ('Small Intestine',  'Small Intestine',  'Small Intestine',  'Offal & by-products', 505),
  ('Large Intestine',  'Large Intestine',  'Large Intestine',  'Offal & by-products', 506),
  ('Provent',          'Provent',          'Provent',          'Offal & by-products', 507),
  ('Crops',            'Crops',            'Crops',            'Offal & by-products', 508),
  ('Blood',            'Blood',            'Blood',            'Offal & by-products', 509),
  ('Trachea',          'Trachea',          'Trachea',          'Offal & by-products', 510),
  ('Mashed Liver',     'Mashed Liver',     'Mashed Liver',     'Offal & by-products', 511),
  ('Pale Liver',       'Pale Liver',       'Pale Liver',       'Offal & by-products', 512),
  ('Trimmings',        'Trimmings',        'Trimmings',        'Offal & by-products', 513),
  ('Neck',             'Neck',             'Neck',             'Offal & by-products', 514),
  ('Fats',             'Fats',             'Fats',             'Offal & by-products', 515),
  ('Spleen',           'Spleen',           'Spleen',           'Offal & by-products', 516)
) AS v(code, name, label_name, class_group, sort_order)
ON CONFLICT (company_id, code) DO UPDATE
  SET label_name  = EXCLUDED.label_name,
      class_group = EXCLUDED.class_group,
      sort_order  = EXCLUDED.sort_order;
-- `name` is intentionally left alone on conflict: a company may have renamed a
-- size for their own floor vocabulary, and the label reads from label_name.
