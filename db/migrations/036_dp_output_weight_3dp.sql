-- 036_dp_output_weight_3dp.sql
-- Production output weights to 3 decimals.
--
-- The weighing machine reads to the gram (14.155 kg) and an upload stores one
-- line per weighing, so 2-decimal columns rounded every line and the batch
-- total drifted. transferred_kg mirrors weight_kg, so it widens too.
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE dp_processed_output
  ALTER COLUMN weight_kg TYPE numeric(15,3),
  ALTER COLUMN transferred_kg TYPE numeric(15,3);
