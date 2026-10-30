-- 033_dp_job_order_crew.sql
-- Expected driver and helper on a live-bird booking, next to the expected
-- truck plate. The booking form picks the plate from the vehicles master and
-- fills these from the truck's default crew; both stay editable.
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE dp_job_orders
  ADD COLUMN IF NOT EXISTS expected_driver varchar(100),
  ADD COLUMN IF NOT EXISTS expected_helper varchar(100);
