-- 027_dp_dressed_items.sql
-- The 46 dressed-chicken classifications as sellable inventory items.
--
-- They already exist as dp_sizes rows (migration 025) so the label printer can
-- name them. That is a *vocabulary*, not stock: it carries no SKU, UoM, cost or
-- price, so nothing can be sold, invoiced, or costed against it. This migration
-- creates the matching `items` rows so the same classifications are usable in
-- Sales, Production Detail (Transfer to WMS), and stock-on-hand.
--
-- SKU scheme — stable, sortable, and readable on a picking list:
--   FC-A-060      Fresh Chilled Class-A 0.6 kg     (weight x100, zero-padded)
--   FC-ANL-070    Fresh Chilled Class-A 0.7 NL
--   FC-A-OVR      oversized variants
--   OFF-GIZZARD   offal & by-products
--
-- Everything is priced at 0: costs and selling prices are commercial data that
-- belongs to the company, not to a migration. Set them in
-- Administration -> Master Data -> Items.

-- The two categories these items live under. Only db/seeds/004 created them,
-- and that seed is not applied to every installation — without this, every item
-- below would land with a NULL category_id and show as uncategorised.
INSERT INTO item_categories (company_id, code, name)
SELECT c.id, v.code, v.name
FROM companies c
CROSS JOIN (VALUES
  ('DRESSED',   'Dressed & Processed'),
  ('BYPRODUCT', 'By-Products')
) AS v(code, name)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO items (company_id, category_id, sku, name, uom, item_type, costing_method,
                   standard_cost, selling_price, reorder_point, is_active)
SELECT c.id,
       (SELECT ic.id FROM item_categories ic
         WHERE ic.company_id = c.id AND ic.code = v.category
         LIMIT 1),
       v.sku, v.name, 'kg', 'stock', 'weighted_avg', 0, 0, 0, true
FROM companies c
CROSS JOIN (VALUES
  -- Squabs ---------------------------------------------------------------
  ('FC-SQUAB',    'SQUABS (0.5 & below)',              'DRESSED'),

  -- Fresh Chilled Class-A, by weight band --------------------------------
  ('FC-A-060',    'Fresh Chilled Class-A 0.6',         'DRESSED'),
  ('FC-A-070',    'Fresh Chilled Class-A 0.7',         'DRESSED'),
  ('FC-A-080',    'Fresh Chilled Class-A 0.8',         'DRESSED'),
  ('FC-A-090',    'Fresh Chilled Class-A 0.9',         'DRESSED'),
  ('FC-A-100',    'Fresh Chilled Class-A 1.0',         'DRESSED'),
  ('FC-A-110',    'Fresh Chilled Class-A 1.1',         'DRESSED'),
  ('FC-A-120',    'Fresh Chilled Class-A 1.2',         'DRESSED'),
  ('FC-A-130',    'Fresh Chilled Class-A 1.3',         'DRESSED'),
  ('FC-A-140',    'Fresh Chilled Class-A 1.4',         'DRESSED'),
  ('FC-A-150',    'Fresh Chilled Class-A 1.5',         'DRESSED'),
  ('FC-A-160',    'Fresh Chilled Class-A 1.6',         'DRESSED'),
  ('FC-A-170',    'Fresh Chilled Class-A 1.7',         'DRESSED'),
  ('FC-A-180',    'Fresh Chilled Class-A 1.8',         'DRESSED'),
  ('FC-A-190',    'Fresh Chilled Class-A 1.9',         'DRESSED'),
  ('FC-A-200',    'Fresh Chilled Class-A 2.0',         'DRESSED'),
  ('FC-A-OVR',    'Fresh Chilled Class-A Oversized',   'DRESSED'),

  -- Fresh Chilled Class-A NL (no liver) ----------------------------------
  ('FC-ANL-070',  'Fresh Chilled Class-A 0.7- NL',     'DRESSED'),
  ('FC-ANL-080',  'Fresh Chilled Class-A 0.8- NL',     'DRESSED'),
  ('FC-ANL-090',  'Fresh Chilled Class-A 0.9- NL',     'DRESSED'),
  ('FC-ANL-100',  'Fresh Chilled Class-A 1.0- NL',     'DRESSED'),
  ('FC-ANL-110',  'Fresh Chilled Class-A 1.1- NL',     'DRESSED'),
  ('FC-ANL-120',  'Fresh Chilled Class-A 1.2- NL',     'DRESSED'),
  ('FC-ANL-130',  'Fresh Chilled Class-A 1.3- NL',     'DRESSED'),
  ('FC-ANL-140',  'Fresh Chilled Class-A 1.4- NL',     'DRESSED'),
  ('FC-ANL-OVR',  'Fresh Chilled Class-NL Oversized',  'DRESSED'),

  -- Other classes --------------------------------------------------------
  ('FC-ASSORTED', 'Fresh Chilled Class Assorted',      'DRESSED'),
  ('FC-C',        'Fresh Chilled Class-C',             'DRESSED'),
  ('FC-CUTUPS',   'Cut ups',                           'DRESSED'),

  -- Offal & by-products --------------------------------------------------
  ('OFF-LIVER',     'Good liver',        'BYPRODUCT'),
  ('OFF-GIZZARD',   'Gizzard',           'BYPRODUCT'),
  ('OFF-FEET',      'Good Feet',         'BYPRODUCT'),
  ('OFF-FEET-TRIM', 'Trimmed Feet',      'BYPRODUCT'),
  ('OFF-HEADS',     'Heads',             'BYPRODUCT'),
  ('OFF-INT-SM',    'Small Intestine',   'BYPRODUCT'),
  ('OFF-INT-LG',    'Large Intestine',   'BYPRODUCT'),
  ('OFF-PROVENT',   'Provent',           'BYPRODUCT'),
  ('OFF-CROPS',     'Crops',             'BYPRODUCT'),
  ('OFF-BLOOD',     'Blood',             'BYPRODUCT'),
  ('OFF-TRACHEA',   'Trachea',           'BYPRODUCT'),
  ('OFF-LIVER-MSH', 'Mashed Liver',      'BYPRODUCT'),
  ('OFF-LIVER-PAL', 'Pale Liver',        'BYPRODUCT'),
  ('OFF-TRIMMINGS', 'Trimmings',         'BYPRODUCT'),
  ('OFF-NECK',      'Neck',              'BYPRODUCT'),
  ('OFF-FATS',      'Fats',              'BYPRODUCT'),
  ('OFF-SPLEEN',    'Spleen',            'BYPRODUCT')
) AS v(sku, name, category)
ON CONFLICT (company_id, sku) DO UPDATE
  SET name        = EXCLUDED.name,
      category_id = EXCLUDED.category_id,
      is_active   = true;
-- Costs and prices are deliberately not touched on conflict: re-running this
-- migration must never wipe pricing a company has already set.

-- Link each classification back to its item, so the label printer, Production
-- Detail and Sales all resolve to the same SKU.
ALTER TABLE dp_sizes ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL;

COMMENT ON COLUMN dp_sizes.item_id IS
  'The sellable item this classification maps to (migration 027).';

-- Mapped by dp_sizes.code -> SKU explicitly. Matching on the display name would
-- silently link nothing: migration 025 stores "Fresh Chilled Class-A 0.6 kg"
-- while the item is named "Fresh Chilled Class-A 0.6".
UPDATE dp_sizes s
   SET item_id = i.id
  FROM items i, (VALUES
    ('SQUABS (0.5 & below)', 'FC-SQUAB'),
    ('0.6', 'FC-A-060'), ('0.7', 'FC-A-070'), ('0.8', 'FC-A-080'), ('0.9', 'FC-A-090'),
    ('1.0', 'FC-A-100'), ('1.1', 'FC-A-110'), ('1.2', 'FC-A-120'), ('1.3', 'FC-A-130'),
    ('1.4', 'FC-A-140'), ('1.5', 'FC-A-150'), ('1.6', 'FC-A-160'), ('1.7', 'FC-A-170'),
    ('1.8', 'FC-A-180'), ('1.9', 'FC-A-190'), ('2.0', 'FC-A-200'),
    ('Oversized', 'FC-A-OVR'),
    ('0.7-NL', 'FC-ANL-070'), ('0.8-NL', 'FC-ANL-080'), ('0.9-NL', 'FC-ANL-090'),
    ('1.0-NL', 'FC-ANL-100'), ('1.1-NL', 'FC-ANL-110'), ('1.2-NL', 'FC-ANL-120'),
    ('1.3-NL', 'FC-ANL-130'), ('1.4-NL', 'FC-ANL-140'),
    ('NL Oversized', 'FC-ANL-OVR'),
    ('Fresh Chilled Class Assorted', 'FC-ASSORTED'),
    ('Fresh Chilled Class-C', 'FC-C'),
    ('Cut ups', 'FC-CUTUPS'),
    ('Good liver', 'OFF-LIVER'), ('Gizzard', 'OFF-GIZZARD'), ('Good Feet', 'OFF-FEET'),
    ('Trimmed Feet', 'OFF-FEET-TRIM'), ('Heads', 'OFF-HEADS'),
    ('Small Intestine', 'OFF-INT-SM'), ('Large Intestine', 'OFF-INT-LG'),
    ('Provent', 'OFF-PROVENT'), ('Crops', 'OFF-CROPS'), ('Blood', 'OFF-BLOOD'),
    ('Trachea', 'OFF-TRACHEA'), ('Mashed Liver', 'OFF-LIVER-MSH'),
    ('Pale Liver', 'OFF-LIVER-PAL'), ('Trimmings', 'OFF-TRIMMINGS'),
    ('Neck', 'OFF-NECK'), ('Fats', 'OFF-FATS'), ('Spleen', 'OFF-SPLEEN')
  ) AS m(code, sku)
 WHERE s.code = m.code
   AND i.sku = m.sku
   AND i.company_id = s.company_id;
