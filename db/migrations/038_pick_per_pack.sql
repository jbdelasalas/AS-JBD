-- 038_pick_per_pack.sql
-- Picking per pack/crate, confirmed by QR scan.
--
-- A production put-away stores each weighed pack as one dp_storage_boxes row;
-- dp_output_id ties the box back to its production line (pack no., heads).
-- A pick-list line can name one box: the whole pack is picked, and the picker
-- scans the bin and then the pack's label so the right item leaves the right bin.
-- Box weights go to 3 decimals to match the production lines.
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE dp_storage_boxes
  ADD COLUMN IF NOT EXISTS dp_output_id uuid REFERENCES dp_processed_output(id) ON DELETE SET NULL;
ALTER TABLE dp_storage_boxes ALTER COLUMN net_weight_kg TYPE numeric(14,3);
CREATE INDEX IF NOT EXISTS idx_dp_boxes_output ON dp_storage_boxes (dp_output_id);
CREATE INDEX IF NOT EXISTS idx_dp_boxes_wh_item ON dp_storage_boxes (warehouse_id, item_id) WHERE status = 'in_storage';

ALTER TABLE pick_list_lines
  ADD COLUMN IF NOT EXISTS box_id         uuid REFERENCES dp_storage_boxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bin_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS box_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS scanned_by     uuid;
CREATE INDEX IF NOT EXISTS idx_pick_lines_box ON pick_list_lines (box_id);
