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

  // Additional companies columns from migration 010
  const companyCols010: [string, string][] = [
    ['accounting_method', "varchar(10) CHECK (accounting_method IN ('ACCRUAL','CASH')) DEFAULT 'ACCRUAL'"],
    ['fiscal_year_start_month', 'int DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12)'],
    ['books_start_date', 'date'],
    ['business_style', 'text'],
    ['registration_date', 'date'],
  ];
  for (const [col, type] of companyCols010) {
    try {
      await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`companies.${col}: ok`);
    } catch (e) { results.push(`companies.${col}: ${(e as Error).message}`); }
  }

  // Branches columns
  const branchCols: [string, string][] = [
    ['phone', 'varchar(50)'],
    ['bir_atp_number', 'varchar(50)'],
    ['ptu_number', 'varchar(50)'],
    ['man_number', 'varchar(50)'],
    ['created_by', 'uuid'],
    ['updated_by', 'uuid'],
  ];
  for (const [col, type] of branchCols) {
    try {
      await query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`branches.${col}: ok`);
    } catch (e) { results.push(`branches.${col}: ${(e as Error).message}`); }
  }

  // --- 009: Stock adjustments, transfers, counts ---
  const client009 = await getPool().connect();
  try {
    await client009.query('BEGIN');
    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id   uuid NOT NULL REFERENCES companies(id),
        adj_no       varchar(30) NOT NULL,
        warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        reason_code  varchar(30) NOT NULL CHECK (reason_code IN ('DAMAGE','SPOILAGE','THEFT','FOUND','COUNT_CORRECTION','RECLASSIFICATION','OTHER')),
        notes        text,
        status       varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','voided')),
        created_by   uuid NOT NULL REFERENCES users(id),
        posted_by    uuid REFERENCES users(id),
        posted_at    timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, adj_no)
      )
    `);
    await client009.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='stock_adjustments_updated') THEN CREATE TRIGGER stock_adjustments_updated BEFORE UPDATE ON stock_adjustments FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
        id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        adj_id     uuid NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
        line_no    int NOT NULL,
        item_id    uuid NOT NULL REFERENCES items(id),
        qty_change numeric(18,4) NOT NULL,
        unit_cost  numeric(18,4) NOT NULL,
        line_total numeric(18,4) NOT NULL,
        notes      text,
        UNIQUE (adj_id, line_no)
      )
    `);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_adj_company_status ON stock_adjustments(company_id, status)`);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_adj_warehouse ON stock_adjustments(warehouse_id)`);

    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id        uuid NOT NULL REFERENCES companies(id),
        transfer_no       varchar(30) NOT NULL,
        from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        to_warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
        status            varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received','cancelled')),
        notes             text,
        sent_at           timestamptz,
        received_at       timestamptz,
        sent_by           uuid REFERENCES users(id),
        received_by       uuid REFERENCES users(id),
        created_by        uuid NOT NULL REFERENCES users(id),
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, transfer_no)
      )
    `);
    await client009.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='stock_transfers_updated') THEN CREATE TRIGGER stock_transfers_updated BEFORE UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_transfer_lines (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        transfer_id       uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
        line_no           int NOT NULL,
        item_id           uuid NOT NULL REFERENCES items(id),
        qty               numeric(18,4) NOT NULL,
        unit_cost_at_send numeric(18,4),
        UNIQUE (transfer_id, line_no)
      )
    `);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_xfr_company_status ON stock_transfers(company_id, status)`);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_xfr_from ON stock_transfers(from_warehouse_id)`);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_xfr_to ON stock_transfers(to_warehouse_id)`);

    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_counts (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id   uuid NOT NULL REFERENCES companies(id),
        count_no     varchar(30) NOT NULL,
        warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        count_type   varchar(20) NOT NULL DEFAULT 'FULL' CHECK (count_type IN ('FULL','CYCLE','SPOT')),
        status       varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','posted','voided')),
        notes        text,
        started_at   timestamptz,
        posted_at    timestamptz,
        started_by   uuid REFERENCES users(id),
        posted_by    uuid REFERENCES users(id),
        created_by   uuid NOT NULL REFERENCES users(id),
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, count_no)
      )
    `);
    await client009.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='stock_counts_updated') THEN CREATE TRIGGER stock_counts_updated BEFORE UPDATE ON stock_counts FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await client009.query(`
      CREATE TABLE IF NOT EXISTS stock_count_lines (
        id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        count_id       uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
        item_id        uuid NOT NULL REFERENCES items(id),
        system_qty     numeric(18,4) NOT NULL DEFAULT 0,
        counted_qty    numeric(18,4) NOT NULL DEFAULT 0,
        variance       numeric(18,4) NOT NULL DEFAULT 0,
        unit_cost      numeric(18,4) NOT NULL DEFAULT 0,
        variance_value numeric(18,4) NOT NULL DEFAULT 0,
        UNIQUE (count_id, item_id)
      )
    `);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_count_company_status ON stock_counts(company_id, status)`);
    await client009.query(`CREATE INDEX IF NOT EXISTS idx_stock_count_warehouse ON stock_counts(warehouse_id)`);

    await client009.query('COMMIT');
    results.push('009 stock_adjustments: ok');
    results.push('009 stock_transfers: ok');
    results.push('009 stock_counts: ok');
  } catch (e) {
    await client009.query('ROLLBACK');
    results.push(`009 FAILED: ${(e as Error).message}`);
  } finally { client009.release(); }

  // --- 010: Admin module tables ---
  const client010 = await getPool().connect();
  try {
    await client010.query('BEGIN');
    // Extend existing tables
    await client010.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_name varchar(200)`);
    await client010.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_status varchar(20) CHECK (vat_status IN ('VAT_REGISTERED','NON_VAT','EXEMPT'))`);
    await client010.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS rdo_code varchar(10)`);
    await client010.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS registered_address text`);
    await client010.query(`ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS fiscal_year_id uuid`);
    await client010.query(`ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS locked_at timestamptz`);
    await client010.query(`ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES users(id)`);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS cost_centers (
        id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        code       varchar(20) NOT NULL,
        name       varchar(100) NOT NULL,
        parent_id  uuid REFERENCES cost_centers(id),
        is_active  boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES users(id),
        updated_by uuid REFERENCES users(id),
        UNIQUE (company_id, code)
      )
    `);
    await client010.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cost_centers_updated') THEN CREATE TRIGGER cost_centers_updated BEFORE UPDATE ON cost_centers FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS fiscal_years (
        id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        year       int NOT NULL,
        start_date date NOT NULL,
        end_date   date NOT NULL,
        is_closed  boolean NOT NULL DEFAULT false,
        closed_at  timestamptz,
        closed_by  uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, year)
      )
    `);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS uoms (
        id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        code       varchar(20) NOT NULL,
        name       varchar(50) NOT NULL,
        type       varchar(10) NOT NULL CHECK (type IN ('COUNT','WEIGHT','VOLUME','LENGTH','TIME')),
        is_base    boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, code)
      )
    `);
    await client010.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='uoms_updated') THEN CREATE TRIGGER uoms_updated BEFORE UPDATE ON uoms FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        code               varchar(20) NOT NULL,
        name               varchar(100) NOT NULL,
        account_id         uuid REFERENCES accounts(id),
        requires_reference boolean NOT NULL DEFAULT false,
        is_active          boolean NOT NULL DEFAULT true,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, code)
      )
    `);
    await client010.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='payment_methods_updated') THEN CREATE TRIGGER payment_methods_updated BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS approval_workflows (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name          varchar(100) NOT NULL,
        document_type varchar(30) NOT NULL,
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        created_by    uuid REFERENCES users(id)
      )
    `);
    await client010.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='approval_workflows_updated') THEN CREATE TRIGGER approval_workflows_updated BEFORE UPDATE ON approval_workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);
    await client010.query(`
      CREATE TABLE IF NOT EXISTS approval_workflow_steps (
        id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id      uuid NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
        step_no          int NOT NULL,
        approver_type    varchar(20) NOT NULL CHECK (approver_type IN ('ROLE','USER','BRANCH_MANAGER')),
        approver_ref     uuid,
        threshold_amount numeric(18,4),
        sla_hours        int,
        created_at       timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workflow_id, step_no)
      )
    `);

    await client010.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name              text UNIQUE NOT NULL,
        enabled           boolean NOT NULL DEFAULT false,
        rollout_companies uuid[] NOT NULL DEFAULT '{}',
        rollout_users     uuid[] NOT NULL DEFAULT '{}',
        description       text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client010.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='feature_flags_updated') THEN CREATE TRIGGER feature_flags_updated BEFORE UPDATE ON feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at(); END IF; END $$`);

    await client010.query(`CREATE INDEX IF NOT EXISTS idx_cost_centers_company ON cost_centers(company_id)`);
    await client010.query(`CREATE INDEX IF NOT EXISTS idx_fiscal_years_company ON fiscal_years(company_id)`);
    await client010.query(`CREATE INDEX IF NOT EXISTS idx_approval_workflows_company ON approval_workflows(company_id, document_type)`);
    await client010.query(`CREATE INDEX IF NOT EXISTS idx_uoms_company ON uoms(company_id)`);
    await client010.query(`CREATE INDEX IF NOT EXISTS idx_payment_methods_company ON payment_methods(company_id)`);

    await client010.query('COMMIT');
    results.push('010 cost_centers: ok');
    results.push('010 fiscal_years: ok');
    results.push('010 uoms: ok');
    results.push('010 payment_methods: ok');
    results.push('010 approval_workflows: ok');
    results.push('010 feature_flags: ok');
  } catch (e) {
    await client010.query('ROLLBACK');
    results.push(`010 FAILED: ${(e as Error).message}`);
  } finally { client010.release(); }

  // --- 011: Admin functions ---
  try {
    await query(`
      CREATE OR REPLACE FUNCTION close_fiscal_period(p_period_id uuid, p_user_id uuid)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        UPDATE fiscal_periods SET status='CLOSED', locked_at=now(), locked_by=p_user_id
        WHERE id=p_period_id AND status IN ('OPEN','ADJUSTING');
        IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal period % not found or not open', p_period_id; END IF;
      END; $fn$
    `);
    results.push('011 close_fiscal_period(): ok');
  } catch (e) { results.push(`011 close_fiscal_period FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION open_fiscal_period(p_period_id uuid, p_user_id uuid)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        UPDATE fiscal_periods SET status='OPEN', locked_at=NULL, locked_by=NULL
        WHERE id=p_period_id AND status='CLOSED';
        IF NOT FOUND THEN RAISE EXCEPTION 'Fiscal period % not closed', p_period_id; END IF;
      END; $fn$
    `);
    results.push('011 open_fiscal_period(): ok');
  } catch (e) { results.push(`011 open_fiscal_period FAILED: ${(e as Error).message}`); }

  // --- 013: BIR extended tables ---
  const client013 = await getPool().connect();
  try {
    await client013.query('BEGIN');

    await client013.query(`
      CREATE TABLE IF NOT EXISTS issued_documents (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id           uuid REFERENCES branches(id),
        document_type       varchar(10) NOT NULL,
        series_id           uuid REFERENCES document_series(id),
        document_no         varchar(50) NOT NULL,
        transaction_date    date NOT NULL,
        customer_id         uuid REFERENCES customers(id),
        customer_tin        varchar(20),
        customer_name       varchar(200) NOT NULL,
        customer_address    text,
        is_vat_registered   boolean NOT NULL DEFAULT false,
        sc_pwd_id           varchar(30),
        total_amount        numeric(18,2) NOT NULL DEFAULT 0,
        vatable_amount      numeric(18,2) NOT NULL DEFAULT 0,
        vat_exempt_amount   numeric(18,2) NOT NULL DEFAULT 0,
        zero_rated_amount   numeric(18,2) NOT NULL DEFAULT 0,
        vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
        sc_discount         numeric(18,2) NOT NULL DEFAULT 0,
        pwd_discount        numeric(18,2) NOT NULL DEFAULT 0,
        total_discount      numeric(18,2) NOT NULL DEFAULT 0,
        net_amount          numeric(18,2) NOT NULL DEFAULT 0,
        status              varchar(20) NOT NULL DEFAULT 'active',
        void_reason         text,
        voided_at           timestamptz,
        voided_by           uuid REFERENCES users(id),
        ar_invoice_id       uuid REFERENCES customers(id),
        created_by          uuid NOT NULL REFERENCES users(id),
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, document_no)
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_issued_documents_company_date ON issued_documents (company_id, transaction_date)`);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_issued_documents_type ON issued_documents (company_id, document_type)`);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_issued_documents_status ON issued_documents (company_id, status)`);
    await client013.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issued_documents_updated') THEN
          CREATE TRIGGER issued_documents_updated BEFORE UPDATE ON issued_documents
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `);

    await client013.query(`
      CREATE OR REPLACE FUNCTION prevent_issued_document_modification()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF OLD.status = 'active' AND NEW.status = 'active' THEN
          IF OLD.document_no <> NEW.document_no
          OR OLD.transaction_date <> NEW.transaction_date
          OR OLD.total_amount <> NEW.total_amount
          OR OLD.net_amount <> NEW.net_amount THEN
            RAISE EXCEPTION 'Active BIR-issued documents cannot be modified.';
          END IF;
        END IF;
        RETURN NEW;
      END; $fn$
    `);
    await client013.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issued_documents_immutable') THEN
          CREATE TRIGGER issued_documents_immutable
            BEFORE UPDATE ON issued_documents
            FOR EACH ROW EXECUTE FUNCTION prevent_issued_document_modification();
        END IF;
      END $$
    `);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS issued_document_lines (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        document_id         uuid NOT NULL REFERENCES issued_documents(id) ON DELETE CASCADE,
        line_no             int NOT NULL,
        description         text NOT NULL,
        quantity            numeric(18,4) NOT NULL DEFAULT 1,
        unit_price          numeric(18,4) NOT NULL DEFAULT 0,
        discount_amount     numeric(18,2) NOT NULL DEFAULT 0,
        vatable_amount      numeric(18,2) NOT NULL DEFAULT 0,
        vat_exempt_amount   numeric(18,2) NOT NULL DEFAULT 0,
        zero_rated_amount   numeric(18,2) NOT NULL DEFAULT 0,
        vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
        line_total          numeric(18,2) NOT NULL DEFAULT 0,
        item_id             uuid REFERENCES items(id),
        tax_code_id         uuid REFERENCES tax_codes(id)
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_issued_doc_lines_document ON issued_document_lines (document_id)`);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS sc_pwd_transactions (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id           uuid REFERENCES branches(id),
        document_id         uuid NOT NULL REFERENCES issued_documents(id),
        sc_pwd_type         varchar(10) NOT NULL,
        id_number           varchar(50) NOT NULL,
        beneficiary_name    varchar(200) NOT NULL,
        osca_number         varchar(50),
        gross_amount        numeric(18,2) NOT NULL,
        discount_rate       numeric(6,4) NOT NULL DEFAULT 0.20,
        discount_amount     numeric(18,2) NOT NULL,
        vat_exemption_amount numeric(18,2) NOT NULL DEFAULT 0,
        net_amount          numeric(18,2) NOT NULL,
        transaction_date    date NOT NULL,
        created_by          uuid NOT NULL REFERENCES users(id),
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_sc_pwd_company_date ON sc_pwd_transactions (company_id, transaction_date)`);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS book_generations (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        branch_id           uuid REFERENCES branches(id),
        book_type           varchar(10) NOT NULL,
        period_year         int NOT NULL,
        period_month        int CHECK (period_month BETWEEN 1 AND 12),
        period_quarter      int CHECK (period_quarter BETWEEN 1 AND 4),
        row_count           int NOT NULL DEFAULT 0,
        total_amount        numeric(18,2) NOT NULL DEFAULT 0,
        status              varchar(20) NOT NULL DEFAULT 'draft',
        storage_path        text,
        generated_by        uuid NOT NULL REFERENCES users(id),
        generated_at        timestamptz NOT NULL DEFAULT now(),
        finalized_at        timestamptz,
        finalized_by        uuid REFERENCES users(id)
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_book_generations_company_period ON book_generations (company_id, period_year, period_month)`);
    await client013.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_book_gen_unique ON book_generations (company_id, book_type, period_year, COALESCE(period_month, 0))`);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS filing_validations (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        filing_id           uuid NOT NULL REFERENCES bir_filings(id) ON DELETE CASCADE,
        validation_type     varchar(10) NOT NULL,
        field_name          varchar(100),
        message             text NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_filing_validations_filing ON filing_validations (filing_id)`);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS excise_rates (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        product_type        varchar(50) NOT NULL,
        description         varchar(200) NOT NULL,
        rate_per_unit       numeric(10,4) NOT NULL,
        unit_of_measure     varchar(20) NOT NULL DEFAULT 'liter',
        effective_date      date NOT NULL,
        end_date            date,
        bir_classification  varchar(50),
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_excise_rates_company ON excise_rates (company_id, product_type, effective_date)`);

    await client013.query(`
      CREATE TABLE IF NOT EXISTS excise_pass_through (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        document_id         uuid NOT NULL REFERENCES issued_documents(id) ON DELETE CASCADE,
        excise_rate_id      uuid NOT NULL REFERENCES excise_rates(id),
        quantity            numeric(18,4) NOT NULL,
        rate_per_unit       numeric(10,4) NOT NULL,
        amount              numeric(18,2) NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client013.query(`CREATE INDEX IF NOT EXISTS idx_excise_pass_through_doc ON excise_pass_through (document_id)`);

    await client013.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_tin varchar(20)`);
    await client013.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_rdo_code varchar(10)`);
    await client013.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_taxpayer_type varchar(20) DEFAULT 'corporation'`);
    await client013.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS bir_line_of_business text`);

    await client013.query(`
      CREATE OR REPLACE FUNCTION bootstrap_bir_defaults(p_company_id uuid)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        IF EXISTS (SELECT 1 FROM excise_rates WHERE company_id = p_company_id LIMIT 1) THEN RETURN; END IF;
        INSERT INTO excise_rates (company_id, product_type, description, rate_per_unit, unit_of_measure, effective_date, bir_classification) VALUES
          (p_company_id, 'diesel',   'Diesel (RR 2-2018)',         6.00, 'liter', '2020-01-01', 'petroleum'),
          (p_company_id, 'gasoline', 'Gasoline (RR 2-2018)',      10.00, 'liter', '2020-01-01', 'petroleum'),
          (p_company_id, 'jet_fuel', 'Aviation Turbo Jet Fuel',    4.00, 'liter', '2020-01-01', 'petroleum'),
          (p_company_id, 'bunker',   'Bunker Fuel Oil',            2.50, 'liter', '2020-01-01', 'petroleum'),
          (p_company_id, 'kerosene', 'Kerosene',                   3.00, 'liter', '2020-01-01', 'petroleum'),
          (p_company_id, 'lpg',      'LPG (per kg)',               3.00, 'kg',    '2020-01-01', 'petroleum'),
          (p_company_id, 'other',    'Other Petroleum Products',   0.00, 'liter', '2020-01-01', 'petroleum');
      END; $fn$
    `);

    await client013.query('COMMIT');
    results.push('013 issued_documents: ok');
    results.push('013 issued_document_lines: ok');
    results.push('013 sc_pwd_transactions: ok');
    results.push('013 book_generations: ok');
    results.push('013 filing_validations: ok');
    results.push('013 excise_rates: ok');
    results.push('013 excise_pass_through: ok');
  } catch (e) {
    await client013.query('ROLLBACK');
    results.push(`013 FAILED: ${(e as Error).message}`);
  } finally { client013.release(); }

  // --- 014: BIR functions ---
  try {
    await query(`
      CREATE OR REPLACE FUNCTION generate_book_sales(p_company_id uuid, p_year int, p_month int)
      RETURNS TABLE (
        transaction_date date, document_no varchar, document_type varchar,
        customer_name varchar, customer_tin varchar, gross_amount numeric,
        exempt_amount numeric, zero_rated_amount numeric, vatable_amount numeric,
        vat_amount numeric, net_amount numeric
      ) LANGUAGE plpgsql AS $fn$
      DECLARE v_start date := make_date(p_year, p_month, 1); v_end date := (v_start + interval '1 month - 1 day')::date;
      BEGIN
        RETURN QUERY SELECT id.transaction_date, id.document_no, id.document_type,
          id.customer_name, id.customer_tin, id.total_amount, id.vat_exempt_amount,
          id.zero_rated_amount, id.vatable_amount, id.vat_amount, id.net_amount
        FROM issued_documents id
        WHERE id.company_id = p_company_id AND id.transaction_date BETWEEN v_start AND v_end
          AND id.status = 'active' AND id.document_type IN ('OR','SI','CI','AR')
        ORDER BY id.transaction_date, id.document_no;
      END; $fn$
    `);
    results.push('014 generate_book_sales(): ok');
  } catch (e) { results.push(`014 generate_book_sales FAILED: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE OR REPLACE FUNCTION generate_book_general_journal(p_company_id uuid, p_year int, p_month int)
      RETURNS TABLE (
        entry_date date, reference_no varchar, description text,
        account_code varchar, account_name varchar, debit numeric, credit numeric
      ) LANGUAGE plpgsql AS $fn$
      DECLARE v_start date := make_date(p_year, p_month, 1); v_end date := (v_start + interval '1 month - 1 day')::date;
      BEGIN
        RETURN QUERY
        SELECT je.entry_date, je.reference_no, je.description,
          a.code AS account_code, a.name AS account_name, jel.debit, jel.credit
        FROM journal_entries je
        JOIN journal_entry_lines jel ON jel.entry_id = je.id
        JOIN accounts a ON a.id = jel.account_id
        WHERE je.company_id = p_company_id AND je.entry_date BETWEEN v_start AND v_end AND je.status = 'posted'
        ORDER BY je.entry_date, je.reference_no, jel.line_no;
      END; $fn$
    `);
    results.push('014 generate_book_general_journal(): ok');
  } catch (e) { results.push(`014 generate_book_general_journal FAILED: ${(e as Error).message}`); }

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

  // ================================================================
  // 008: AR module complete (sales order enhancements, delivery receipts,
  //      credit memos, enhanced customer_payments, document series)
  // ================================================================

  // Enhance sales_orders
  const salesOrderCols: [string, string][] = [
    ['notes', 'text'],
    ['payment_terms_days', 'int NOT NULL DEFAULT 30'],
    ['discount_pct', 'numeric(5,2) NOT NULL DEFAULT 0'],
    ['warehouse_id', 'uuid'],
    ['approved_by', 'uuid'],
    ['approved_at', 'timestamptz'],
    ['approval_notes', 'text'],
    ['cancelled_by', 'uuid'],
    ['cancelled_at', 'timestamptz'],
    ['cancel_reason', 'text'],
    ['credit_checked', 'boolean NOT NULL DEFAULT false'],
  ];
  for (const [col, type] of salesOrderCols) {
    try {
      await query(`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`sales_orders.${col}: ok`);
    } catch (e) { results.push(`sales_orders.${col}: ${(e as Error).message}`); }
  }

  const salesOrderLineCols: [string, string][] = [
    ['qty_reserved', 'numeric(18,4) NOT NULL DEFAULT 0'],
    ['unit_cost', 'numeric(18,4) NOT NULL DEFAULT 0'],
    ['discount_pct', 'numeric(5,2) NOT NULL DEFAULT 0'],
    ['line_subtotal', 'numeric(18,2) NOT NULL DEFAULT 0'],
    ['line_vat', 'numeric(18,2) NOT NULL DEFAULT 0'],
  ];
  for (const [col, type] of salesOrderLineCols) {
    try {
      await query(`ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`sales_order_lines.${col}: ok`);
    } catch (e) { results.push(`sales_order_lines.${col}: ${(e as Error).message}`); }
  }

  // Enhance sales_invoices
  const salesInvoiceCols: [string, string][] = [
    ['so_id', 'uuid'],
    ['notes', 'text'],
    ['payment_terms_days', 'int NOT NULL DEFAULT 30'],
    ['discount_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
    ['approved_by', 'uuid'],
    ['approved_at', 'timestamptz'],
    ['voided_at', 'timestamptz'],
    ['voided_by', 'uuid'],
    ['void_reason', 'text'],
    ['dr_id', 'uuid'],
    ['je_id', 'uuid'],
    ['currency', "varchar(3) NOT NULL DEFAULT 'PHP'"],
  ];
  for (const [col, type] of salesInvoiceCols) {
    try {
      await query(`ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`sales_invoices.${col}: ok`);
    } catch (e) { results.push(`sales_invoices.${col}: ${(e as Error).message}`); }
  }

  // Delivery receipts table
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS delivery_receipts (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        branch_id     uuid REFERENCES branches(id),
        dr_no         varchar(30) NOT NULL,
        so_id         uuid NOT NULL REFERENCES sales_orders(id),
        customer_id   uuid NOT NULL REFERENCES customers(id),
        warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
        delivery_date date NOT NULL,
        notes         text,
        status        varchar(20) NOT NULL DEFAULT 'draft',
        posted_at     timestamptz,
        posted_by     uuid REFERENCES users(id),
        je_id         uuid REFERENCES journal_entries(id),
        created_by    uuid NOT NULL REFERENCES users(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, dr_no)
      )
    `);
    results.push('delivery_receipts table: ok');
  } catch (e) { results.push(`delivery_receipts table: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS delivery_receipt_lines (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        dr_id         uuid NOT NULL REFERENCES delivery_receipts(id) ON DELETE CASCADE,
        so_line_id    uuid REFERENCES sales_order_lines(id),
        line_no       int NOT NULL,
        item_id       uuid NOT NULL REFERENCES items(id),
        description   text NOT NULL,
        qty_delivered numeric(18,4) NOT NULL,
        unit_cost     numeric(18,4) NOT NULL DEFAULT 0,
        UNIQUE (dr_id, line_no)
      )
    `);
    results.push('delivery_receipt_lines table: ok');
  } catch (e) { results.push(`delivery_receipt_lines table: ${(e as Error).message}`); }

  // Inventory reservations
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS inventory_reservations (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        so_id        uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        so_line_id   uuid NOT NULL REFERENCES sales_order_lines(id) ON DELETE CASCADE,
        item_id      uuid NOT NULL REFERENCES items(id),
        warehouse_id uuid NOT NULL REFERENCES warehouses(id),
        qty_reserved numeric(18,4) NOT NULL,
        reserved_at  timestamptz NOT NULL DEFAULT now(),
        released_at  timestamptz,
        status       varchar(20) NOT NULL DEFAULT 'active',
        UNIQUE (so_line_id)
      )
    `);
    results.push('inventory_reservations table: ok');
  } catch (e) { results.push(`inventory_reservations table: ${(e as Error).message}`); }

  // AR credit memos
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ar_credit_memos (
        id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        branch_id           uuid REFERENCES branches(id),
        cm_no               varchar(30) NOT NULL,
        customer_id         uuid NOT NULL REFERENCES customers(id),
        original_invoice_id uuid REFERENCES sales_invoices(id),
        cm_date             date NOT NULL,
        reason              varchar(200),
        notes               text,
        subtotal            numeric(18,2) NOT NULL DEFAULT 0,
        vat_amount          numeric(18,2) NOT NULL DEFAULT 0,
        total               numeric(18,2) NOT NULL DEFAULT 0,
        amount_applied      numeric(18,2) NOT NULL DEFAULT 0,
        unapplied_amount    numeric(18,2) NOT NULL DEFAULT 0,
        status              varchar(20) NOT NULL DEFAULT 'draft',
        approved_by         uuid REFERENCES users(id),
        approved_at         timestamptz,
        cancelled_by        uuid REFERENCES users(id),
        cancelled_at        timestamptz,
        cancel_reason       text,
        je_id               uuid REFERENCES journal_entries(id),
        created_by          uuid NOT NULL REFERENCES users(id),
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, cm_no)
      )
    `);
    results.push('ar_credit_memos table: ok');
  } catch (e) { results.push(`ar_credit_memos table: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ar_credit_memo_lines (
        id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        cm_id              uuid NOT NULL REFERENCES ar_credit_memos(id) ON DELETE CASCADE,
        line_no            int NOT NULL,
        item_id            uuid REFERENCES items(id),
        description        text NOT NULL,
        quantity           numeric(18,4) NOT NULL,
        unit_price         numeric(18,4) NOT NULL,
        vat_rate           numeric(5,2) NOT NULL DEFAULT 12.00,
        line_subtotal      numeric(18,2) NOT NULL,
        line_vat           numeric(18,2) NOT NULL,
        line_total         numeric(18,2) NOT NULL,
        revenue_account_id uuid REFERENCES accounts(id),
        UNIQUE (cm_id, line_no)
      )
    `);
    results.push('ar_credit_memo_lines table: ok');
  } catch (e) { results.push(`ar_credit_memo_lines table: ${(e as Error).message}`); }

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ar_credit_memo_applications (
        id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        cm_id          uuid NOT NULL REFERENCES ar_credit_memos(id) ON DELETE CASCADE,
        invoice_id     uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
        amount_applied numeric(18,2) NOT NULL CHECK (amount_applied > 0),
        applied_at     timestamptz NOT NULL DEFAULT now(),
        applied_by     uuid REFERENCES users(id),
        UNIQUE (cm_id, invoice_id)
      )
    `);
    results.push('ar_credit_memo_applications table: ok');
  } catch (e) { results.push(`ar_credit_memo_applications table: ${(e as Error).message}`); }

  // Enhance customer_payments
  const customerPaymentCols: [string, string][] = [
    ['unapplied_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
    ['is_advance', 'boolean NOT NULL DEFAULT false'],
    ['notes', 'text'],
    ['bank_ref', 'varchar(100)'],
    ['check_date', 'date'],
    ['voided_by', 'uuid'],
    ['voided_at', 'timestamptz'],
    ['void_reason', 'text'],
    ['bank_account_id', 'uuid'],
  ];
  for (const [col, type] of customerPaymentCols) {
    try {
      await query(`ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      results.push(`customer_payments.${col}: ok`);
    } catch (e) { results.push(`customer_payments.${col}: ${(e as Error).message}`); }
  }

  // payment_applications table
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS payment_applications (
        id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        payment_id     uuid NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
        invoice_id     uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
        amount_applied numeric(18,2) NOT NULL CHECK (amount_applied > 0),
        applied_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (payment_id, invoice_id)
      )
    `);
    results.push('payment_applications table: ok');
  } catch (e) { results.push(`payment_applications table: ${(e as Error).message}`); }

  // Document series for AR module
  const arDocTypes = ['sales_order', 'delivery_receipt', 'credit_memo', 'official_receipt'];
  const arPrefixes: Record<string, string> = {
    sales_order: 'SO-',
    delivery_receipt: 'DR-',
    credit_memo: 'CM-',
    official_receipt: 'OR-',
  };
  for (const docType of arDocTypes) {
    try {
      await query(
        `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
         SELECT id, $1, $2 || to_char(now(), 'YYYY') || '-', 1, 0 FROM companies
         ON CONFLICT DO NOTHING`,
        [docType, arPrefixes[docType]],
      );
      results.push(`document_series ${docType}: ok`);
    } catch (e) { results.push(`document_series ${docType}: ${(e as Error).message}`); }
  }

  // customers table: ensure payment_terms_days exists
  try {
    await query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 30`);
    results.push('customers.payment_terms_days: ok');
  } catch (e) { results.push(`customers.payment_terms_days: ${(e as Error).message}`); }

  // ================================================================
  // TEST DATA SEED — idempotent (ON CONFLICT DO NOTHING)
  // ================================================================
  const CO  = '11111111-1111-1111-1111-111111111111';
  const USR = '99999999-9999-9999-9999-999999999999';
  const HO  = '22222222-2222-2222-2222-222222222201';

  // Item categories
  try {
    await query(`
      INSERT INTO item_categories (id, company_id, code, name) VALUES
        ('aaaa0001-0000-0000-0000-000000000001', $1, 'FUEL',  'Fuel Products'),
        ('aaaa0001-0000-0000-0000-000000000002', $1, 'LUBE',  'Lubricants'),
        ('aaaa0001-0000-0000-0000-000000000003', $1, 'PARTS', 'Spare Parts')
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed item_categories: ok');
  } catch (e) { results.push(`seed item_categories: ${(e as Error).message}`); }

  // Warehouse
  try {
    await query(`
      INSERT INTO warehouses (id, company_id, code, name, address, is_active) VALUES
        ('bbbb0001-0000-0000-0000-000000000001', $1, 'WH-MAIN', 'Main Warehouse', 'Manila', true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed warehouse: ok');
  } catch (e) { results.push(`seed warehouse: ${(e as Error).message}`); }

  // Items
  try {
    await query(`
      INSERT INTO items (id, company_id, category_id, sku, name, uom, item_type, costing_method, standard_cost, selling_price, is_active) VALUES
        ('cccc0001-0000-0000-0000-000000000001', $1, 'aaaa0001-0000-0000-0000-000000000001', 'DIESEL',    'Diesel Fuel',       'liter', 'product', 'AVERAGE', 55.00, 65.00, true),
        ('cccc0001-0000-0000-0000-000000000002', $1, 'aaaa0001-0000-0000-0000-000000000001', 'GAS91',     'Gasoline 91',       'liter', 'product', 'AVERAGE', 58.00, 68.00, true),
        ('cccc0001-0000-0000-0000-000000000003', $1, 'aaaa0001-0000-0000-0000-000000000001', 'GAS95',     'Gasoline 95',       'liter', 'product', 'AVERAGE', 62.00, 72.00, true),
        ('cccc0001-0000-0000-0000-000000000004', $1, 'aaaa0001-0000-0000-0000-000000000002', 'OIL-10W40', 'Engine Oil 10W-40', 'liter', 'product', 'FIFO',    350.00, 450.00, true),
        ('cccc0001-0000-0000-0000-000000000005', $1, 'aaaa0001-0000-0000-0000-000000000002', 'OIL-20W50', 'Engine Oil 20W-50', 'liter', 'product', 'FIFO',    320.00, 420.00, true),
        ('cccc0001-0000-0000-0000-000000000006', $1, 'aaaa0001-0000-0000-0000-000000000003', 'FILTER-OIL','Oil Filter',        'pcs',   'product', 'FIFO',    85.00,  120.00, true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed items: ok');
  } catch (e) { results.push(`seed items: ${(e as Error).message}`); }

  // Stock balances (no company_id column — unique on item_id + warehouse_id)
  try {
    await query(`
      INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost) VALUES
        ('cccc0001-0000-0000-0000-000000000001', 'bbbb0001-0000-0000-0000-000000000001', 50000, 55.00),
        ('cccc0001-0000-0000-0000-000000000002', 'bbbb0001-0000-0000-0000-000000000001', 20000, 58.00),
        ('cccc0001-0000-0000-0000-000000000003', 'bbbb0001-0000-0000-0000-000000000001', 15000, 62.00),
        ('cccc0001-0000-0000-0000-000000000004', 'bbbb0001-0000-0000-0000-000000000001', 500,   350.00),
        ('cccc0001-0000-0000-0000-000000000005', 'bbbb0001-0000-0000-0000-000000000001', 300,   320.00),
        ('cccc0001-0000-0000-0000-000000000006', 'bbbb0001-0000-0000-0000-000000000001', 200,   85.00)
      ON CONFLICT (item_id, warehouse_id) DO NOTHING`);
    results.push('seed stock_balances: ok');
  } catch (e) { results.push(`seed stock_balances: ${(e as Error).message}`); }

  // Customers — use code prefix TEST-C so they don't conflict with API-generated CUST-xxxxxx
  try {
    await query(`
      INSERT INTO customers (id, company_id, code, name, customer_type, tin, address, contact_person, email, phone, payment_terms_days, credit_limit, is_active) VALUES
        ('dddd0001-0000-0000-0000-000000000001', $1, 'TEST-C001', 'ABC Transport Corp.',    'fleet',     '123-456-789-000', 'Quezon City', 'Juan Dela Cruz', 'juan@abc.com',   '09171234567', 30, 500000, true),
        ('dddd0001-0000-0000-0000-000000000002', $1, 'TEST-C002', 'XYZ Logistics Inc.',     'wholesale', '987-654-321-000', 'Makati City', 'Maria Santos',   'maria@xyz.com',  '09281234567', 15, 1000000, true),
        ('dddd0001-0000-0000-0000-000000000003', $1, 'TEST-C003', 'Dela Cruz Construction', 'wholesale', '111-222-333-000', 'Pasig City',  'Pedro Reyes',    'pedro@dc.com',   '09391234567', 45, 750000, true),
        ('dddd0001-0000-0000-0000-000000000004', $1, 'TEST-C004', 'Metro Bus Lines',        'fleet',     '444-555-666-000', 'Manila',      'Ana Villanueva', 'ana@mbl.com',    '09451234567', 30, 2000000, true),
        ('dddd0001-0000-0000-0000-000000000005', $1, 'TEST-C005', 'Govt Infra Dept.',       'gov',       '777-888-999-000', 'Intramuros',  'Dir. Ramos',     'ramos@gov.ph',   '09561234567', 60, 5000000, true)
      ON CONFLICT (company_id, code) DO NOTHING`, [CO]);
    results.push('seed customers: ok');
  } catch (e) { results.push(`seed customers: ${(e as Error).message}`); }

  // Suppliers — no credit_limit column on suppliers table
  try {
    await query(`
      INSERT INTO suppliers (id, company_id, code, name, supplier_type, tin, address, contact_person, email, phone, payment_terms_days, is_active) VALUES
        ('eeee0001-0000-0000-0000-000000000001', $1, 'TEST-S001', 'Petron Corp.',       'refinery', '000-111-222-000', 'Bonifacio Global City', 'Sales Team',    'sales@petron.com',   '025551001', 30, true),
        ('eeee0001-0000-0000-0000-000000000002', $1, 'TEST-S002', 'Shell Philippines',  'refinery', '000-222-333-000', 'Makati City',           'Key Accounts',  'keyaccts@shell.com', '025551002', 30, true),
        ('eeee0001-0000-0000-0000-000000000003', $1, 'TEST-S003', 'Castrol Philippines','trade',    '000-333-444-000', 'Mandaluyong',           'Lube Sales',    'sales@castrol.com',  '025551003', 30, true),
        ('eeee0001-0000-0000-0000-000000000004', $1, 'TEST-S004', 'Auto Parts Depot',   'trade',    '000-444-555-000', 'Caloocan',              'Parts Manager', 'parts@apd.com',      '025551004', 15, true)
      ON CONFLICT (company_id, code) DO NOTHING`, [CO]);
    results.push('seed suppliers: ok');
  } catch (e) { results.push(`seed suppliers: ${(e as Error).message}`); }

  // Sales invoices — use subquery to get customer IDs by code (resilient to ON CONFLICT skips)
  try {
    await query(`
      INSERT INTO sales_invoices
        (id, company_id, branch_id, invoice_no, customer_id, invoice_date, due_date,
         payment_terms_days, currency, subtotal, vat_amount, total, amount_paid, balance, discount_amount, status, created_by)
      SELECT
        v.id::uuid, $1, $2, v.invoice_no,
        (SELECT id FROM customers WHERE company_id = $1 AND code = v.ccode LIMIT 1),
        v.inv_date::date, v.due_date::date, v.terms::int, 'PHP',
        v.subtotal::numeric, v.vat::numeric, v.total::numeric,
        v.paid::numeric, v.bal::numeric, 0, v.status, $3
      FROM (VALUES
        ('ffff0001-0000-0000-0000-000000000001','SI-2026-000001','TEST-C001','2026-04-10','2026-05-10',30, 89285.71,10714.29,100000.00,     0,100000.00,'open'),
        ('ffff0001-0000-0000-0000-000000000002','SI-2026-000002','TEST-C002','2026-04-15','2026-04-30',15,178571.43,21428.57,200000.00, 50000,150000.00,'partially_paid'),
        ('ffff0001-0000-0000-0000-000000000003','SI-2026-000003','TEST-C003','2026-03-01','2026-04-15',45,267857.14,32142.86,300000.00,     0,300000.00,'overdue'),
        ('ffff0001-0000-0000-0000-000000000004','SI-2026-000004','TEST-C004','2026-05-01','2026-05-31',30,446428.57,53571.43,500000.00,     0,500000.00,'open'),
        ('ffff0001-0000-0000-0000-000000000005','SI-2026-000005','TEST-C001','2026-04-20','2026-04-30',10, 44642.86, 5357.14, 50000.00, 50000,      0,'paid')
      ) AS v(id, invoice_no, ccode, inv_date, due_date, terms, subtotal, vat, total, paid, bal, status)
      WHERE (SELECT id FROM customers WHERE company_id = $1 AND code = v.ccode LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed sales_invoices: ok');
  } catch (e) { results.push(`seed sales_invoices: ${(e as Error).message}`); }

  // Sales invoice lines
  try {
    await query(`
      INSERT INTO sales_invoice_lines
        (invoice_id, line_no, item_id, description, quantity, unit_price, discount_pct, vat_rate, line_subtotal, line_vat, line_total)
      SELECT v.inv_id::uuid, v.line_no::int, v.item_id::uuid, v.desc, v.qty::numeric, v.price::numeric, 0, 12, v.sub::numeric, v.vat::numeric, v.tot::numeric
      FROM (VALUES
        ('ffff0001-0000-0000-0000-000000000001',1,'cccc0001-0000-0000-0000-000000000001','Diesel Fuel',   1373.66,65.00, 89285.71,10714.29,100000.00),
        ('ffff0001-0000-0000-0000-000000000002',1,'cccc0001-0000-0000-0000-000000000002','Gasoline 91',   2625.66,68.00,178571.43,21428.57,200000.00),
        ('ffff0001-0000-0000-0000-000000000003',1,'cccc0001-0000-0000-0000-000000000001','Diesel Fuel',   4122.45,65.00,267857.14,32142.86,300000.00),
        ('ffff0001-0000-0000-0000-000000000004',1,'cccc0001-0000-0000-0000-000000000001','Diesel Fuel',   6868.91,65.00,446428.57,53571.43,500000.00),
        ('ffff0001-0000-0000-0000-000000000005',1,'cccc0001-0000-0000-0000-000000000002','Gasoline 91',    735.29,68.00, 44642.86, 5357.14, 50000.00)
      ) AS v(inv_id, line_no, item_id, desc, qty, price, sub, vat, tot)
      WHERE EXISTS (SELECT 1 FROM sales_invoices WHERE id = v.inv_id::uuid)
      ON CONFLICT DO NOTHING`);
    results.push('seed sales_invoice_lines: ok');
  } catch (e) { results.push(`seed sales_invoice_lines: ${(e as Error).message}`); }

  // AP bills (table is `bills`, not supplier_bills) — use valid hex UUIDs only (a-f, 0-9)
  try {
    await query(`
      INSERT INTO bills
        (id, company_id, branch_id, bill_no, internal_no, supplier_id, bill_date, due_date,
         currency, subtotal, vat_amount, ewt_amount, total, amount_paid, balance, status, created_by)
      SELECT
        v.id::uuid, $1, $2, v.bill_no, v.internal_no,
        (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1),
        v.bill_date::date, v.due_date::date, 'PHP',
        v.subtotal::numeric, v.vat::numeric, 0, v.total::numeric,
        v.paid::numeric, v.bal::numeric, v.status, $3
      FROM (VALUES
        ('a1b20001-0000-0000-0000-000000000001','PETRON-INV-001','BL-2026-000001','TEST-S001','2026-04-05','2026-05-05',2232142.86,267857.14,2500000.00,1000000,1500000.00,'approved'),
        ('a1b20001-0000-0000-0000-000000000002','SHELL-INV-002', 'BL-2026-000002','TEST-S002','2026-04-12','2026-05-12', 892857.14,107142.86,1000000.00,      0,1000000.00,'approved'),
        ('a1b20001-0000-0000-0000-000000000003','CASTROL-INV-003','BL-2026-000003','TEST-S003','2026-03-15','2026-04-14',178571.43, 21428.57, 200000.00,      0, 200000.00,'approved')
      ) AS v(id, bill_no, internal_no, scode, bill_date, due_date, subtotal, vat, total, paid, bal, status)
      WHERE (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed bills: ok');
  } catch (e) { results.push(`seed bills: ${(e as Error).message}`); }

  // Bill lines (table is `bill_lines`)
  try {
    await query(`
      INSERT INTO bill_lines (bill_id, line_no, item_id, description, quantity, unit_price, vat_rate, line_subtotal, line_vat, line_total)
      SELECT v.bill_id::uuid, v.ln::int, v.item_id::uuid, v.desc, v.qty::numeric, v.price::numeric, 12, v.sub::numeric, v.vat::numeric, v.tot::numeric
      FROM (VALUES
        ('a1b20001-0000-0000-0000-000000000001',1,'cccc0001-0000-0000-0000-000000000001','Diesel Fuel',     40000,55.00,2200000.00,264000.00,2464000.00),
        ('a1b20001-0000-0000-0000-000000000001',2,'cccc0001-0000-0000-0000-000000000002','Gasoline 91',       600,55.00,  33000.00,  3960.00,  36960.00),
        ('a1b20001-0000-0000-0000-000000000002',1,'cccc0001-0000-0000-0000-000000000002','Gasoline 91',     15000,58.00, 870000.00,104400.00, 974400.00),
        ('a1b20001-0000-0000-0000-000000000003',1,'cccc0001-0000-0000-0000-000000000004','Engine Oil 10W-40', 500,350.00,175000.00, 21000.00, 196000.00)
      ) AS v(bill_id, ln, item_id, desc, qty, price, sub, vat, tot)
      WHERE EXISTS (SELECT 1 FROM bills WHERE id = v.bill_id::uuid)
      ON CONFLICT DO NOTHING`);
    results.push('seed bill_lines: ok');
  } catch (e) { results.push(`seed bill_lines: ${(e as Error).message}`); }

  // Customer payments — valid hex UUIDs
  try {
    await query(`
      INSERT INTO customer_payments
        (id, company_id, branch_id, receipt_no, customer_id, payment_date, payment_method,
         amount, unapplied_amount, is_advance, status, created_by)
      SELECT v.id::uuid, $1, $2, v.receipt_no,
        (SELECT id FROM customers WHERE company_id = $1 AND code = v.ccode LIMIT 1),
        v.pdate::date, v.method, v.amount::numeric, 0, false, 'posted', $3
      FROM (VALUES
        ('a1b30001-0000-0000-0000-000000000001','OR-2026-000001','TEST-C002','2026-04-20','bank_transfer',50000.00),
        ('a1b30001-0000-0000-0000-000000000002','OR-2026-000002','TEST-C001','2026-04-25','cash',          50000.00)
      ) AS v(id, receipt_no, ccode, pdate, method, amount)
      WHERE (SELECT id FROM customers WHERE company_id = $1 AND code = v.ccode LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed customer_payments: ok');
  } catch (e) { results.push(`seed customer_payments: ${(e as Error).message}`); }

  // Journal entries — valid hex UUIDs
  try {
    await query(`
      INSERT INTO journal_entries
        (id, company_id, branch_id, entry_no, entry_date, memo, source_module, status, posted_at, posted_by, created_by)
      VALUES
        ('a1b40001-0000-0000-0000-000000000001', $1, $2, 'JV-2026-000001', '2026-04-10',
         'Sales invoice SI-2026-000001 - ABC Transport', 'ar', 'posted', '2026-04-10 08:00:00+08', $3, $3),
        ('a1b40001-0000-0000-0000-000000000002', $1, $2, 'JV-2026-000002', '2026-04-15',
         'Sales invoice SI-2026-000002 - XYZ Logistics', 'ar', 'posted', '2026-04-15 08:00:00+08', $3, $3)
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed journal_entries: ok');
  } catch (e) { results.push(`seed journal_entries: ${(e as Error).message}`); }

  return ok({ results });
}
