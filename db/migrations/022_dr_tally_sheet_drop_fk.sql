-- Drop FK constraint on delivery_receipts.tally_sheet_id (keep column as plain uuid)
ALTER TABLE delivery_receipts
  DROP CONSTRAINT IF EXISTS delivery_receipts_tally_sheet_id_fkey;

-- Ensure column exists without FK
ALTER TABLE delivery_receipts
  ADD COLUMN IF NOT EXISTS tally_sheet_id uuid;
