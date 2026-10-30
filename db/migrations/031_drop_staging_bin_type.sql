-- 031_drop_staging_bin_type.sql
-- Drop the 'staging' bin type — not used in Art Fresh's warehouse flow.
-- Picked goods go straight from picking bins to the shipping dock.
--
-- Fails if any bin is still typed 'staging'; retype those first.
-- Run against both schemas the app serves (public and sandbox); skipped where
-- the bins table does not exist yet.

DO $$
BEGIN
  IF to_regclass('bins') IS NOT NULL THEN
    ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_bin_type_check;
    ALTER TABLE bins ADD CONSTRAINT bins_bin_type_check
      CHECK (bin_type IN ('receiving','storage','picking','shipping'));
  END IF;
END $$;
