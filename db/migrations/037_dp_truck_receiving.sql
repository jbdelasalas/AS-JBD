-- 037_dp_truck_receiving.sql
-- Dressing-plant receiving per truck, plus what the Live Harvest Report and the
-- Basic Production Report need.
--
-- A batch arrives on several trucks; each truck is one dp_receiving_weights row
-- (plant count = head_count, plant weight = gross - tare). The batch leaves the
-- Receiving list when receiving_completed_at is set. Report-only entries
-- (packaging, ice, manpower, trimmings, prepared by) live in report_extras.
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE dp_receiving_weights
  ADD COLUMN IF NOT EXISTS seq            integer,
  ADD COLUMN IF NOT EXISTS plate_no       varchar(30),
  ADD COLUMN IF NOT EXISTS seal_no        varchar(40),
  ADD COLUMN IF NOT EXISTS farm_name      text,
  ADD COLUMN IF NOT EXISTS farm_address   text,
  ADD COLUMN IF NOT EXISTS house_no       varchar(30),
  ADD COLUMN IF NOT EXISTS farm_count     integer,
  ADD COLUMN IF NOT EXISTS farm_weight_kg numeric(15,3),
  ADD COLUMN IF NOT EXISTS doa_weight_kg  numeric(15,3),
  ADD COLUMN IF NOT EXISTS farm_departure time,
  ADD COLUMN IF NOT EXISTS plant_arrival  time,
  ADD COLUMN IF NOT EXISTS start_hang     time,
  ADD COLUMN IF NOT EXISTS end_hang       time;

ALTER TABLE dp_job_orders
  ADD COLUMN IF NOT EXISTS receiving_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS harvest_date           date,
  ADD COLUMN IF NOT EXISTS plant_checker          text,
  ADD COLUMN IF NOT EXISTS report_extras          jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Batches received before trucks existed were received in one go: close them.
UPDATE dp_job_orders jo
   SET receiving_completed_at = r.last_at
  FROM (SELECT job_order_id, MAX(created_at) AS last_at FROM dp_receiving_weights GROUP BY job_order_id) r
 WHERE r.job_order_id = jo.id AND jo.receiving_completed_at IS NULL;

UPDATE dp_receiving_weights SET seq = 1 WHERE seq IS NULL;

-- Production put-aways go pack by pack: each put-away line names the production
-- line (one weighing = one pack/crate) it bins. SET NULL so re-saving production
-- after a put-away was cancelled doesn't trip over the old reference.
ALTER TABLE putaway_lines
  ADD COLUMN IF NOT EXISTS dp_output_id uuid REFERENCES dp_processed_output(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_putaway_lines_dp_output ON putaway_lines(dp_output_id);

-- Weighing order within a batch (pack #1 = first weighing); lines are saved in
-- one statement, so created_at can't tell them apart.
ALTER TABLE dp_processed_output ADD COLUMN IF NOT EXISTS line_no integer;
UPDATE dp_processed_output po SET line_no = x.n
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY job_order_id ORDER BY created_at, id) AS n FROM dp_processed_output) x
 WHERE x.id = po.id AND po.line_no IS NULL;
