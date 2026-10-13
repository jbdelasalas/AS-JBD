-- 030_so_receiving_hours.sql
-- Receiving hours per sales order.
--
-- A client's usual receiving hours live on the customer record (029). One
-- delivery can still differ — a stall closing early on a fiesta day, a
-- restaurant asking for a later drop — so the order carries its own hours.
-- Blank on the order means "use the client's usual"; the trip planner reads
-- COALESCE(order, customer).
--
-- Run against both schemas the app serves (public and sandbox).

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS receiving_from time,
  ADD COLUMN IF NOT EXISTS receiving_to   time;
