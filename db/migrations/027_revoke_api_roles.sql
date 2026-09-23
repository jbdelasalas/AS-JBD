-- 027_revoke_api_roles.sql
-- ============================================================================
-- Stop future tables from being exposed through the Supabase API
-- ============================================================================
-- Audited 2026-09-23 after finding both customer portals fully readable through
-- PostgREST by anyone holding the publishable (anon) key. This database is in
-- better shape: `anon` currently holds zero table grants, and a probe as that
-- role was denied — so nothing is exposed today.
--
-- What is wrong is the *default privileges*. pg_default_acl carries
-- `anon=arwdDxtm` for relations, meaning every table a future migration creates
-- is granted SELECT/INSERT/UPDATE/DELETE to `anon` automatically. The ERP gains
-- tables regularly, so this is a hole waiting for the next migration to open —
-- and it would open silently, which is how the portals ended up exposed.
--
-- `anon` also holds USAGE on the public schema, which is the other half of what
-- a PostgREST request needs.
--
-- This application never uses PostgREST: apps/web queries through `pg` as the
-- `postgres` role from server code, and there is no browser-side Supabase
-- client anywhere in apps/web/src. So the API roles need no access at all.
--
-- (Contrast Hearty SIRS, which DOES use the browser client and correctly
-- relies on RLS policies. Do not copy this file there — revoking would break
-- that app. Verified: its anonymous reads return zero rows and writes fail
-- with 42501.)

-- Anything currently granted, in case a later hand-edit added something.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- The schema itself: without USAGE, a PostgREST request cannot resolve a table
-- name even if a grant were somehow restored.
REVOKE ALL ON SCHEMA public FROM anon, authenticated;

-- The actual fix: stop the automatic grant on tables created from now on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Default privileges are recorded per granting role, so the blanket statement
-- above does not always cover objects created by `postgres` specifically —
-- which is the role these migrations run as.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
          'REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE 'Per-role default privileges not settable here; blanket revoke stands.';
END$$;

-- `service_role` keeps its access on purpose: that is the secret key, it is
-- never shipped to a browser, and it is what server-side tooling uses.
--
-- RLS is deliberately NOT enabled here. With no grant there is nothing for a
-- policy to protect, and enabling it across 162 tables on a live accounting
-- database is a change with real breakage risk for no added safety while the
-- app connects as the table owner. The revoke above is the control.
