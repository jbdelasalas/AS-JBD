-- Link delivery_receipts back to the tally_sheet that originated them
ALTER TABLE delivery_receipts
  ADD COLUMN IF NOT EXISTS tally_sheet_id uuid REFERENCES tally_sheets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dr_tally_sheet ON delivery_receipts (tally_sheet_id);
