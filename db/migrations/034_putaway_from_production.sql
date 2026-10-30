-- 034_putaway_from_production.sql
-- Put-away can start from a dressing-plant batch, same as a goods receipt.
--
-- Production output goes from DP into the warehouse through a put-away whose
-- source is the batch (the old "Transfer to WMS" step is gone). Posting it adds
-- to the warehouse total, bins the stock, starts cold-storage billing and marks
-- the production lines put away into that warehouse (transferred_warehouse_id).
-- A put-away has at most one source.
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE dp_processed_output
  ADD COLUMN IF NOT EXISTS transferred_warehouse_id uuid REFERENCES warehouses(id);

ALTER TABLE putaways ADD COLUMN IF NOT EXISTS job_order_id uuid REFERENCES dp_job_orders(id);
ALTER TABLE putaways DROP CONSTRAINT IF EXISTS putaways_one_source;
ALTER TABLE putaways ADD CONSTRAINT putaways_one_source CHECK (num_nonnulls(grn_id, transfer_id, job_order_id) <= 1);
CREATE INDEX IF NOT EXISTS idx_putaways_job_order ON putaways(job_order_id);

-- The put-away records where each cold-storage box went. Same columns as the
-- inventory-QR migration adds; repeated here for schemas that never ran it.
ALTER TABLE dp_storage_boxes
  ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES bins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES item_lots(id) ON DELETE SET NULL;
