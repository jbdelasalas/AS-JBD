export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { ok, err } from '@/lib/api-response';

const SECRET = 'migrate-as-jbd-2026';

export async function POST(request: NextRequest) {
  const { secret } = await request.json().catch(() => ({ secret: '' }));
  if (secret !== SECRET) return err('Forbidden', 403);

  const results: string[] = [];

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        text PRIMARY KEY,
        value      text NOT NULL,
        updated_by uuid,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    results.push('app_settings table: ok');
  } catch (e) { results.push(`app_settings table: ${(e as Error).message}`); }

  const seeds = [
    ['dark_mode', 'false'],
    ['brand_theme', 'blue'],
    ['login_bg', ''],
    ['company_name', ''],
  ];
  for (const [key, value] of seeds) {
    try {
      await query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [key, value],
      );
      results.push(`seed ${key}: ok`);
    } catch (e) { results.push(`seed ${key}: ${(e as Error).message}`); }
  }

  const cols = [
    ['phone', 'varchar(50)'],
    ['email', 'varchar(200)'],
    ['website', 'varchar(200)'],
    ['logo', 'text'],
  ];
  for (const [col, type] of cols) {
    try {
      await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`companies.${col}: ok`);
    } catch (e) { results.push(`companies.${col}: ${(e as Error).message}`); }
  }

  // --- 015: Report metadata tables ---
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS report_definitions (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        slug                text NOT NULL,
        name                text NOT NULL,
        category            text NOT NULL,
        description         text,
        base_view_or_proc   text NOT NULL,
        default_filters     jsonb NOT NULL DEFAULT '{}',
        column_definitions  jsonb,
        is_system           boolean NOT NULL DEFAULT false,
        created_by          uuid REFERENCES users(id),
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, slug)
      )
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'report_definitions_updated') THEN
          CREATE TRIGGER report_definitions_updated BEFORE UPDATE ON report_definitions
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views (user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_views_company_slug ON saved_views (company_id, report_slug)`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saved_views_updated') THEN
          CREATE TRIGGER saved_views_updated BEFORE UPDATE ON saved_views
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_report_runs_company ON report_runs (company_id, report_slug)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_report_runs_user ON report_runs (user_id)`);

    await client.query(`
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
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_report_snapshots_key ON report_snapshots (company_id, report_slug, snapshot_key)`);

    await client.query('COMMIT');
    results.push('015 report_definitions: ok');
    results.push('015 saved_views: ok');
    results.push('015 report_runs: ok');
    results.push('015 report_snapshots: ok');
  } catch (e) {
    await client.query('ROLLBACK');
    results.push(`015 FAILED: ${(e as Error).message}`);
  } finally { client.release(); }

  // --- 016: Views ---
  const views: [string, string][] = [
    ['v_gl_detail', `
      CREATE OR REPLACE VIEW v_gl_detail AS
      SELECT
        je.id AS entry_id, je.entry_no, je.entry_date, je.posted_at, je.voided_at,
        je.fiscal_period_id, je.source_module, je.source_doc_type, je.source_doc_id, je.company_id,
        jel.line_no, jel.account_id,
        a.code AS account_code, a.name AS account_name, a.account_type,
        at.is_balance_sheet, at.normal_side,
        jel.debit, jel.credit, jel.description AS memo, je.branch_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.entry_id = je.id
      JOIN accounts a ON a.id = jel.account_id
      JOIN account_types at ON at.code = a.account_type
      WHERE je.status = 'posted'
    `],
    ['v_sales_register', `
      CREATE OR REPLACE VIEW v_sales_register AS
      SELECT d.id, d.company_id, d.branch_id, d.document_type, d.document_no,
        d.transaction_date, d.customer_name, d.customer_tin, d.vatable_amount, d.vat_amount,
        d.vat_exempt_amount, d.zero_rated_amount, d.sc_discount, d.pwd_discount,
        d.total_amount, d.net_amount, d.status, d.voided_at
      FROM issued_documents d
      WHERE d.document_type IN ('OR', 'SI', 'CI')
    `],
    ['v_purchase_register', `
      CREATE OR REPLACE VIEW v_purchase_register AS
      SELECT b.id, b.company_id, b.branch_id, b.bill_no, b.internal_no, b.bill_date,
        s.name AS supplier_name, s.tin AS supplier_tin,
        b.subtotal AS vatable_amount, b.vat_amount, b.total, b.amount_paid, b.balance, b.status
      FROM bills b
      JOIN suppliers s ON s.id = b.supplier_id
    `],
    ['v_ar_open_balance', `
      CREATE OR REPLACE VIEW v_ar_open_balance AS
      SELECT inv.id AS invoice_id, inv.invoice_no, inv.invoice_date, inv.due_date,
        inv.customer_id, c.name AS customer_name,
        inv.total AS original_amount,
        COALESCE(SUM(pa.amount_applied), 0) AS paid_amount,
        inv.balance, inv.company_id, inv.branch_id, inv.status
      FROM sales_invoices inv
      LEFT JOIN payment_applications pa ON pa.invoice_id = inv.id
      JOIN customers c ON c.id = inv.customer_id
      WHERE inv.status NOT IN ('voided', 'draft')
      GROUP BY inv.id, c.name
    `],
    ['v_ap_open_balance', `
      CREATE OR REPLACE VIEW v_ap_open_balance AS
      SELECT b.id AS bill_id, b.bill_no, b.internal_no, b.bill_date, b.due_date,
        b.supplier_id, s.name AS supplier_name,
        b.total AS original_amount,
        COALESCE(SUM(bpa.amount_applied), 0) AS paid_amount,
        b.balance, b.company_id, b.branch_id, b.status
      FROM bills b
      LEFT JOIN bill_payment_applications bpa ON bpa.bill_id = b.id
      JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.status NOT IN ('void', 'draft')
      GROUP BY b.id, s.name
    `],
    ['v_cash_movements', `
      CREATE OR REPLACE VIEW v_cash_movements AS
      SELECT je.company_id, je.branch_id, je.entry_date, je.source_doc_type, je.source_doc_id,
        jel.debit AS cash_in, jel.credit AS cash_out,
        a.code AS account_code, a.name AS account_name, je.posted_at
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE a.account_type IN ('cash', 'bank')
        AND je.status = 'posted'
    `],
  ];

  for (const [name, sql] of views) {
    try {
      await query(sql);
      results.push(`016 ${name}: ok`);
    } catch (e) { results.push(`016 ${name} FAILED: ${(e as Error).message}`); }
  }

  // --- 017: Functions ---
  try {
    await query(`
      CREATE OR REPLACE FUNCTION trial_balance(
        p_company_id uuid, p_as_of timestamptz, p_branch_id uuid DEFAULT NULL
      ) RETURNS TABLE (
        account_code text, account_name text, account_type text,
        is_balance_sheet boolean, normal_side text,
        period_debit numeric(18,4), period_credit numeric(18,4), ending_balance numeric(18,4)
      ) LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN QUERY
        WITH filtered_gl AS (
          SELECT g.* FROM v_gl_detail g
          WHERE g.company_id = p_company_id
            AND g.posted_at <= p_as_of
            AND (g.voided_at IS NULL OR g.voided_at > p_as_of)
            AND (p_branch_id IS NULL OR g.branch_id = p_branch_id)
        )
        SELECT a.code, a.name, a.account_type, at.is_balance_sheet, at.normal_side,
          COALESCE(SUM(f.debit), 0)::numeric(18,4),
          COALESCE(SUM(f.credit), 0)::numeric(18,4),
          (COALESCE(SUM(f.debit), 0) - COALESCE(SUM(f.credit), 0))::numeric(18,4)
        FROM accounts a
        JOIN account_types at ON at.code = a.account_type
        LEFT JOIN filtered_gl f ON f.account_id = a.id
        WHERE a.company_id = p_company_id AND a.is_active = true
        GROUP BY a.id, a.code, a.name, a.account_type, at.is_balance_sheet, at.normal_side
        ORDER BY a.code;
      END; $$
    `);
    results.push('017 trial_balance(): ok');
  } catch (e) { results.push(`017 trial_balance FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION income_statement(
        p_company_id uuid, p_start_date date, p_end_date date, p_branch_id uuid DEFAULT NULL
      ) RETURNS TABLE (
        account_type text, account_code text, account_name text, normal_side text,
        period_debit numeric(18,4), period_credit numeric(18,4), net_amount numeric(18,4)
      ) LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN QUERY
        WITH period_gl AS (
          SELECT g.* FROM v_gl_detail g
          WHERE g.company_id = p_company_id
            AND g.entry_date BETWEEN p_start_date AND p_end_date
            AND g.voided_at IS NULL
            AND (p_branch_id IS NULL OR g.branch_id = p_branch_id)
        )
        SELECT a.account_type, a.code, a.name, at.normal_side,
          COALESCE(SUM(p.debit), 0)::numeric(18,4),
          COALESCE(SUM(p.credit), 0)::numeric(18,4),
          CASE WHEN at.normal_side = 'credit'
            THEN (COALESCE(SUM(p.credit), 0) - COALESCE(SUM(p.debit), 0))
            ELSE (COALESCE(SUM(p.debit), 0) - COALESCE(SUM(p.credit), 0))
          END::numeric(18,4)
        FROM accounts a
        JOIN account_types at ON at.code = a.account_type
        LEFT JOIN period_gl p ON p.account_id = a.id
        WHERE a.company_id = p_company_id AND a.is_active = true AND at.is_balance_sheet = false
        GROUP BY a.id, a.account_type, a.code, a.name, at.normal_side
        HAVING COALESCE(SUM(p.debit), 0) + COALESCE(SUM(p.credit), 0) > 0
        ORDER BY a.account_type, a.code;
      END; $$
    `);
    results.push('017 income_statement(): ok');
  } catch (e) { results.push(`017 income_statement FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION ar_aging(
        p_company_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_customer_id uuid DEFAULT NULL
      ) RETURNS TABLE (
        customer_id uuid, customer_name text, invoice_id uuid, invoice_no text,
        invoice_date date, due_date date, original numeric(18,2), paid numeric(18,2),
        balance numeric(18,2), days_overdue int, aging_bucket text
      ) LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN QUERY
        SELECT ar.customer_id, ar.customer_name, ar.invoice_id, ar.invoice_no,
          ar.invoice_date::date, ar.due_date::date,
          ar.original_amount, ar.paid_amount, ar.balance,
          GREATEST((p_as_of - ar.due_date::date)::int, 0),
          CASE
            WHEN ar.balance <= 0 THEN 'current'
            WHEN (p_as_of - ar.due_date::date) <= 0 THEN 'current'
            WHEN (p_as_of - ar.due_date::date) BETWEEN 1  AND 30  THEN '1-30'
            WHEN (p_as_of - ar.due_date::date) BETWEEN 31 AND 60  THEN '31-60'
            WHEN (p_as_of - ar.due_date::date) BETWEEN 61 AND 90  THEN '61-90'
            ELSE '91+'
          END
        FROM v_ar_open_balance ar
        WHERE ar.company_id = p_company_id AND ar.balance > 0
          AND (p_customer_id IS NULL OR ar.customer_id = p_customer_id)
        ORDER BY ar.customer_name, ar.due_date;
      END; $$
    `);
    results.push('017 ar_aging(): ok');
  } catch (e) { results.push(`017 ar_aging FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION ap_aging(
        p_company_id uuid, p_as_of date DEFAULT CURRENT_DATE, p_supplier_id uuid DEFAULT NULL
      ) RETURNS TABLE (
        supplier_id uuid, supplier_name text, bill_id uuid, bill_no text,
        bill_date date, due_date date, original numeric(18,2), paid numeric(18,2),
        balance numeric(18,2), days_overdue int, aging_bucket text
      ) LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN QUERY
        SELECT ap.supplier_id, ap.supplier_name, ap.bill_id, ap.bill_no,
          ap.bill_date::date, ap.due_date::date,
          ap.original_amount, ap.paid_amount, ap.balance,
          GREATEST((p_as_of - ap.due_date::date)::int, 0),
          CASE
            WHEN ap.balance <= 0 THEN 'current'
            WHEN (p_as_of - ap.due_date::date) <= 0 THEN 'current'
            WHEN (p_as_of - ap.due_date::date) BETWEEN 1  AND 30  THEN '1-30'
            WHEN (p_as_of - ap.due_date::date) BETWEEN 31 AND 60  THEN '31-60'
            WHEN (p_as_of - ap.due_date::date) BETWEEN 61 AND 90  THEN '61-90'
            ELSE '91+'
          END
        FROM v_ap_open_balance ap
        WHERE ap.company_id = p_company_id AND ap.balance > 0
          AND (p_supplier_id IS NULL OR ap.supplier_id = p_supplier_id)
        ORDER BY ap.supplier_name, ap.due_date;
      END; $$
    `);
    results.push('017 ap_aging(): ok');
  } catch (e) { results.push(`017 ap_aging FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION sales_summary(
        p_company_id uuid, p_start_date date, p_end_date date, p_group_by text DEFAULT 'day'
      ) RETURNS TABLE (
        period text, doc_count bigint, vatable numeric(18,2), vat_amount numeric(18,2),
        exempt numeric(18,2), zero_rated numeric(18,2), gross_sales numeric(18,2), net_sales numeric(18,2)
      ) LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN QUERY
        SELECT
          CASE p_group_by WHEN 'month' THEN to_char(s.transaction_date, 'YYYY-MM') ELSE s.transaction_date::text END,
          COUNT(*),
          COALESCE(SUM(s.vatable_amount), 0)::numeric(18,2),
          COALESCE(SUM(s.vat_amount), 0)::numeric(18,2),
          COALESCE(SUM(s.vat_exempt_amount), 0)::numeric(18,2),
          COALESCE(SUM(s.zero_rated_amount), 0)::numeric(18,2),
          COALESCE(SUM(s.total_amount), 0)::numeric(18,2),
          COALESCE(SUM(s.net_amount), 0)::numeric(18,2)
        FROM v_sales_register s
        WHERE s.company_id = p_company_id
          AND s.transaction_date BETWEEN p_start_date AND p_end_date
          AND s.status = 'active'
        GROUP BY 1 ORDER BY 1;
      END; $$
    `);
    results.push('017 sales_summary(): ok');
  } catch (e) { results.push(`017 sales_summary FAILED: ${(e as Error).message}`); }

  return ok({ results });
}
