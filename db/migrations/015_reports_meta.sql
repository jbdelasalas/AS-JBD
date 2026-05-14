-- 015_reports_meta.sql
-- Report metadata tables: definitions, saved views, run history, snapshots.
-- No RLS — access control at API route level via requireAuth.

CREATE TABLE IF NOT EXISTS report_definitions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  slug                text NOT NULL,
  name                text NOT NULL,
  category            text NOT NULL, -- financial | sales | purchases | inventory | bir | operational | custom
  description         text,
  base_view_or_proc   text NOT NULL,
  default_filters     jsonb NOT NULL DEFAULT '{}',
  column_definitions  jsonb,
  is_system           boolean NOT NULL DEFAULT false,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);
CREATE TRIGGER report_definitions_updated BEFORE UPDATE ON report_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_slug text NOT NULL,
  name        text NOT NULL,
  filters     jsonb NOT NULL DEFAULT '{}',
  visibility  text NOT NULL CHECK (visibility IN ('personal', 'company')) DEFAULT 'personal',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_views_user ON saved_views (user_id);
CREATE INDEX idx_saved_views_company_slug ON saved_views (company_id, report_slug);
CREATE TRIGGER saved_views_updated BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS report_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  report_slug     text NOT NULL,
  filters         jsonb NOT NULL DEFAULT '{}',
  executed_at     timestamptz NOT NULL DEFAULT now(),
  duration_ms     int,
  row_count       int,
  export_format   text CHECK (export_format IN ('csv', 'xlsx', 'pdf', 'none')),
  status          text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_runs_company ON report_runs (company_id, report_slug);
CREATE INDEX idx_report_runs_user ON report_runs (user_id);

CREATE TABLE IF NOT EXISTS report_snapshots (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_slug     text NOT NULL,
  snapshot_key    text NOT NULL,
  period_start    date,
  period_end      date,
  as_of           timestamptz,
  payload         jsonb NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, report_slug, snapshot_key)
);
CREATE INDEX idx_report_snapshots_key ON report_snapshots (company_id, report_slug, snapshot_key);
