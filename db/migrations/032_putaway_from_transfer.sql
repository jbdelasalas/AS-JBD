-- 032_putaway_from_transfer.sql
-- Put-away can start from a received stock transfer, not only a goods receipt.
--
-- Receiving a transfer (Inventory → Transfers) already adds to the destination
-- warehouse's stock_balances. The put-away then assigns that qty to bins —
-- same as a goods receipt, so posting it touches only bin_stock_balances.
-- A put-away has at most one source.
--
-- Run against both schemas the app serves (public and sandbox); skipped where
-- the WMS tables do not exist yet.

DO $$
BEGIN
  IF to_regclass('putaways') IS NOT NULL AND to_regclass('stock_transfers') IS NOT NULL THEN
    ALTER TABLE putaways ADD COLUMN IF NOT EXISTS transfer_id uuid REFERENCES stock_transfers(id);
    ALTER TABLE putaways DROP CONSTRAINT IF EXISTS putaways_one_source;
    ALTER TABLE putaways ADD CONSTRAINT putaways_one_source CHECK (grn_id IS NULL OR transfer_id IS NULL);
    CREATE INDEX IF NOT EXISTS idx_putaways_transfer ON putaways(transfer_id);
  END IF;
END $$;
