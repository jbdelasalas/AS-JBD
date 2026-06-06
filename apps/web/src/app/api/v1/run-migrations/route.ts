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
    ['allow_negative_inventory', 'boolean NOT NULL DEFAULT false'],
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
    ['bir_atp_valid_from', 'date'],
    ['bir_atp_valid_to', 'date'],
    ['ptu_number', 'varchar(50)'],
    ['man_number', 'varchar(50)'],
    ['manager_user_id', 'uuid'],
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
    ['posted_at', 'timestamptz'],
    ['posted_by', 'uuid'],
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

  // Document series for AR module + GL
  const arDocTypes = ['sales_order', 'delivery_receipt', 'credit_memo', 'official_receipt', 'journal_voucher'];
  const arPrefixes: Record<string, string> = {
    sales_order: 'SO-',
    delivery_receipt: 'DR-',
    credit_memo: 'CM-',
    official_receipt: 'OR-',
    journal_voucher: 'JV-',
  };
  for (const docType of arDocTypes) {
    try {
      await query(
        `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
         SELECT c.id, $1::varchar, ($2 || to_char(now(), 'YYYY') || '-')::varchar, 1, 0
         FROM companies c
         WHERE NOT EXISTS (SELECT 1 FROM document_series ds WHERE ds.company_id = c.id AND ds.doc_type = $1::varchar)`,
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

  // Seed fiscal_periods for 2025 and 2026 (all 12 months, status open)
  try {
    await query(`
      INSERT INTO fiscal_periods (company_id, year, period, start_date, end_date, status)
      SELECT c.id,
             y.yr,
             m.mo,
             make_date(y.yr, m.mo, 1),
             (make_date(y.yr, m.mo, 1) + interval '1 month - 1 day')::date,
             'open'
      FROM companies c
      CROSS JOIN (VALUES (2025),(2026)) AS y(yr)
      CROSS JOIN generate_series(1,12) AS m(mo)
      WHERE NOT EXISTS (
        SELECT 1 FROM fiscal_periods fp
        WHERE fp.company_id = c.id AND fp.year = y.yr AND fp.period = m.mo
      )
    `);
    results.push('seed fiscal_periods 2025-2026: ok');
  } catch (e) { results.push(`seed fiscal_periods: ${(e as Error).message}`); }

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
        ('aaaa0001-0000-0000-0000-000000000001', $1, 'DOC',   'Day-Old Chicks'),
        ('aaaa0001-0000-0000-0000-000000000002', $1, 'FEEDS', 'Poultry Feeds'),
        ('aaaa0001-0000-0000-0000-000000000003', $1, 'VET',   'Medicines & Vaccines'),
        ('aaaa0001-0000-0000-0000-000000000004', $1, 'BIRDS', 'Live Birds')
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed item_categories: ok');
  } catch (e) { results.push(`seed item_categories: ${(e as Error).message}`); }

  // Locations (Warehouses)
  try {
    await query(`
      INSERT INTO warehouses (id, company_id, code, name, address, is_active) VALUES
        ('bbbb0001-0000-0000-0000-000000000001', $1, 'WH-MAIN',   'Main Feed Store',          'Head Office, Manila',              true),
        ('bbbb0001-0000-0000-0000-000000000002', $1, 'WH-FARM1',  'Farm Site 1 Feed Store',   'San Pablo, Laguna',                true),
        ('bbbb0001-0000-0000-0000-000000000003', $1, 'WH-FARM2',  'Farm Site 2 Feed Store',   'Calamba, Laguna',                  true),
        ('bbbb0001-0000-0000-0000-000000000004', $1, 'WH-MEDS',   'Medicine & Vaccine Store', 'Head Office, Manila',              true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed locations: ok');
  } catch (e) { results.push(`seed locations: ${(e as Error).message}`); }

  // Items
  try {
    await query(`
      INSERT INTO items (id, company_id, category_id, sku, name, uom, item_type, costing_method, standard_cost, selling_price, is_active) VALUES
        ('cccc0001-0000-0000-0000-000000000001', $1, 'aaaa0001-0000-0000-0000-000000000001', 'DOC-ROSS308',  'Ross 308 Day-Old Chicks',       'heads', 'product', 'AVERAGE',  45.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000002', $1, 'aaaa0001-0000-0000-0000-000000000001', 'DOC-COBB500',  'Cobb 500 Day-Old Chicks',       'heads', 'product', 'AVERAGE',  42.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000003', $1, 'aaaa0001-0000-0000-0000-000000000002', 'FEED-STARTER', 'Starter Mash (50kg bag)',        'bags',  'product', 'AVERAGE', 850.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000004', $1, 'aaaa0001-0000-0000-0000-000000000002', 'FEED-GROWER',  'Grower Pellets (50kg bag)',      'bags',  'product', 'AVERAGE', 820.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000005', $1, 'aaaa0001-0000-0000-0000-000000000002', 'FEED-FINISH',  'Finisher Pellets (50kg bag)',    'bags',  'product', 'AVERAGE', 800.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000006', $1, 'aaaa0001-0000-0000-0000-000000000003', 'VAC-ND',       'Newcastle Disease Vaccine',      'vials', 'product', 'FIFO',     25.00,   0.00, true),
        ('cccc0001-0000-0000-0000-000000000007', $1, 'aaaa0001-0000-0000-0000-000000000004', 'LB-BROILER',   'Live Broiler Chicken',          'kg',    'product', 'AVERAGE',  95.00, 115.00, true),
        ('cccc0001-0000-0000-0000-000000000008', $1, 'aaaa0001-0000-0000-0000-000000000004', 'DC-DRESSED',   'Dressed Chicken (whole)',        'kg',    'product', 'AVERAGE', 140.00, 175.00, true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('seed items: ok');
  } catch (e) { results.push(`seed items: ${(e as Error).message}`); }

  // Stock balances (no company_id column — unique on item_id + warehouse_id)
  try {
    await query(`
      INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost) VALUES
        ('cccc0001-0000-0000-0000-000000000003', 'bbbb0001-0000-0000-0000-000000000002', 500,  850.00),
        ('cccc0001-0000-0000-0000-000000000004', 'bbbb0001-0000-0000-0000-000000000002', 300,  820.00),
        ('cccc0001-0000-0000-0000-000000000005', 'bbbb0001-0000-0000-0000-000000000002', 200,  800.00),
        ('cccc0001-0000-0000-0000-000000000006', 'bbbb0001-0000-0000-0000-000000000004', 100,   25.00)
      ON CONFLICT (item_id, warehouse_id) DO NOTHING`);
    results.push('seed stock_balances: ok');
  } catch (e) { results.push(`seed stock_balances: ${(e as Error).message}`); }

  // 020 — seed items/warehouse/categories for every company that has none yet
  try {
    await query(`
      DO $$
      DECLARE
        co    RECORD;
        cat1  uuid; cat2 uuid; cat3 uuid;
        wh    uuid;
        it1   uuid; it2  uuid; it3  uuid; it4  uuid; it5  uuid; it6  uuid;
      BEGIN
        FOR co IN
          SELECT id FROM companies
          WHERE is_active = true
            AND NOT EXISTS (SELECT 1 FROM items i WHERE i.company_id = companies.id)
        LOOP
          -- get or create categories
          SELECT id INTO cat1 FROM item_categories WHERE company_id = co.id AND code = 'DOC' LIMIT 1;
          IF cat1 IS NULL THEN
            cat1 := gen_random_uuid();
            INSERT INTO item_categories (id, company_id, code, name) VALUES (cat1, co.id, 'DOC', 'Day-Old Chicks');
          END IF;

          SELECT id INTO cat2 FROM item_categories WHERE company_id = co.id AND code = 'FEEDS' LIMIT 1;
          IF cat2 IS NULL THEN
            cat2 := gen_random_uuid();
            INSERT INTO item_categories (id, company_id, code, name) VALUES (cat2, co.id, 'FEEDS', 'Poultry Feeds');
          END IF;

          SELECT id INTO cat3 FROM item_categories WHERE company_id = co.id AND code = 'VET' LIMIT 1;
          IF cat3 IS NULL THEN
            cat3 := gen_random_uuid();
            INSERT INTO item_categories (id, company_id, code, name) VALUES (cat3, co.id, 'VET', 'Medicines & Vaccines');
          END IF;

          -- get or create warehouse
          SELECT id INTO wh FROM warehouses WHERE company_id = co.id AND is_active = true LIMIT 1;
          IF wh IS NULL THEN
            wh := gen_random_uuid();
            INSERT INTO warehouses (id, company_id, code, name, is_active)
            VALUES (wh, co.id, 'WH-MAIN', 'Main Warehouse', true);
          END IF;

          -- insert sample items
          it1 := gen_random_uuid(); it2 := gen_random_uuid(); it3 := gen_random_uuid();
          it4 := gen_random_uuid(); it5 := gen_random_uuid(); it6 := gen_random_uuid();

          INSERT INTO items (id, company_id, category_id, sku, name, uom, item_type, costing_method, standard_cost, selling_price, is_active) VALUES
            (it1, co.id, cat1, 'DOC-ROSS308',  'Ross 308 Day-Old Chicks',    'heads', 'product', 'AVERAGE',  45.00,   0.00, true),
            (it2, co.id, cat1, 'DOC-COBB500',  'Cobb 500 Day-Old Chicks',    'heads', 'product', 'AVERAGE',  42.00,   0.00, true),
            (it3, co.id, cat2, 'FEED-STARTER', 'Starter Mash (50kg bag)',    'bags',  'product', 'AVERAGE', 850.00,   0.00, true),
            (it4, co.id, cat2, 'FEED-GROWER',  'Grower Pellets (50kg bag)',  'bags',  'product', 'AVERAGE', 820.00,   0.00, true),
            (it5, co.id, cat2, 'FEED-FINISH',  'Finisher Pellets (50kg bag)','bags',  'product', 'AVERAGE', 800.00,   0.00, true),
            (it6, co.id, cat3, 'VAC-ND',       'Newcastle Disease Vaccine',  'vials', 'product', 'FIFO',     25.00,   0.00, true)
          ON CONFLICT DO NOTHING;

          -- stock balances (feeds only; chick batches managed separately)
          INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost) VALUES
            (it3, wh, 500, 850.00),
            (it4, wh, 300, 820.00),
            (it5, wh, 200, 800.00),
            (it6, wh, 100,  25.00)
          ON CONFLICT (item_id, warehouse_id) DO NOTHING;
        END LOOP;
      END;
      $$`);
    results.push('020 seed items for all companies: ok');
  } catch (e) { results.push(`020 seed items for all companies: ${(e as Error).message}`); }

  // 021 — Poultry Operations tables
  const poultryTables = [
    [`farm_buildings`, `CREATE TABLE IF NOT EXISTS farm_buildings (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id    uuid NOT NULL REFERENCES companies(id),
      branch_id     uuid REFERENCES branches(id),
      code          text NOT NULL,
      name          text NOT NULL,
      capacity_heads int,
      building_type text DEFAULT 'broiler',
      is_active     boolean DEFAULT true,
      created_at    timestamptz DEFAULT now(),
      UNIQUE (company_id, code)
    )`],
    [`order_ins`, `CREATE TABLE IF NOT EXISTS order_ins (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       uuid NOT NULL REFERENCES companies(id),
      doc_no           text NOT NULL,
      supplier_id      uuid NOT NULL REFERENCES suppliers(id),
      branch_id        uuid REFERENCES branches(id),
      reference_no     text,
      transaction_date date NOT NULL,
      date_needed      date,
      delivery_method  text,
      payment_terms    text,
      remarks          text,
      notes            text,
      status           text NOT NULL DEFAULT 'saved',
      total_amount     numeric(14,2) DEFAULT 0,
      created_by       uuid,
      confirmed_by     uuid,
      posted_by        uuid,
      voided_by        uuid,
      created_at       timestamptz DEFAULT now(),
      confirmed_at     timestamptz,
      posted_at        timestamptz,
      voided_at        timestamptz,
      UNIQUE (company_id, doc_no)
    )`],
    [`order_in_lines`, `CREATE TABLE IF NOT EXISTS order_in_lines (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_in_id   uuid NOT NULL REFERENCES order_ins(id) ON DELETE CASCADE,
      line_no       int NOT NULL,
      item_id       uuid NOT NULL REFERENCES items(id),
      quantity      numeric(14,4) NOT NULL DEFAULT 0,
      uom           text NOT NULL DEFAULT 'heads',
      unit_price    numeric(12,4) DEFAULT 0,
      amount        numeric(14,2) DEFAULT 0,
      remarks       text
    )`],
    [`inventory_ins`, `CREATE TABLE IF NOT EXISTS inventory_ins (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       uuid NOT NULL REFERENCES companies(id),
      doc_no           text NOT NULL,
      order_in_id      uuid REFERENCES order_ins(id),
      supplier_id      uuid NOT NULL REFERENCES suppliers(id),
      warehouse_id     uuid REFERENCES warehouses(id),
      branch_id        uuid REFERENCES branches(id),
      transaction_date date NOT NULL,
      delivery_method  text,
      contact_person   text,
      remarks          text,
      notes            text,
      status           text NOT NULL DEFAULT 'saved',
      created_by       uuid,
      posted_by        uuid,
      posted_at        timestamptz,
      created_at       timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`inventory_in_lines`, `CREATE TABLE IF NOT EXISTS inventory_in_lines (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      inventory_in_id   uuid NOT NULL REFERENCES inventory_ins(id) ON DELETE CASCADE,
      line_no           int NOT NULL,
      item_id           uuid NOT NULL REFERENCES items(id),
      batch_no          text,
      quantity_received numeric(14,4) NOT NULL DEFAULT 0,
      quantity_doa      numeric(14,4) DEFAULT 0,
      net_quantity      numeric(14,4) DEFAULT 0,
      unit_cost         numeric(12,4) DEFAULT 0,
      total_cost        numeric(14,2) DEFAULT 0,
      remarks           text
    )`],
    [`chick_batches`, `CREATE TABLE IF NOT EXISTS chick_batches (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id        uuid NOT NULL REFERENCES companies(id),
      batch_no          text NOT NULL,
      inventory_in_id   uuid REFERENCES inventory_ins(id),
      inv_line_id       uuid REFERENCES inventory_in_lines(id),
      item_id           uuid NOT NULL REFERENCES items(id),
      heads_in          numeric(14,4) NOT NULL DEFAULT 0,
      heads_available   numeric(14,4) NOT NULL DEFAULT 0,
      date_received     date NOT NULL,
      status            text NOT NULL DEFAULT 'available',
      UNIQUE (company_id, batch_no)
    )`],
    [`grow_cycles`, `CREATE TABLE IF NOT EXISTS grow_cycles (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id            uuid NOT NULL REFERENCES companies(id),
      doc_no                text NOT NULL,
      year                  int NOT NULL,
      branch_id             uuid REFERENCES branches(id),
      building_id           uuid REFERENCES farm_buildings(id),
      batch_id              uuid NOT NULL REFERENCES chick_batches(id),
      heads_in              numeric(14,4) NOT NULL DEFAULT 0,
      start_date            date NOT NULL,
      expected_end_date     date,
      actual_end_date       date,
      est_harvest_recovery  numeric(5,2),
      total_mortality       numeric(14,4) DEFAULT 0,
      heads_available       numeric(14,4) DEFAULT 0,
      heads_harvested       numeric(14,4) DEFAULT 0,
      status                text NOT NULL DEFAULT 'active',
      remarks               text,
      created_by            uuid,
      created_at            timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`grow_mortality_logs`, `CREATE TABLE IF NOT EXISTS grow_mortality_logs (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      grow_cycle_id   uuid NOT NULL REFERENCES grow_cycles(id) ON DELETE CASCADE,
      log_date        date NOT NULL,
      heads           numeric(14,4) NOT NULL DEFAULT 0,
      cause           text,
      recorded_by     uuid,
      created_at      timestamptz DEFAULT now()
    )`],
    [`tally_sheets`, `CREATE TABLE IF NOT EXISTS tally_sheets (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id        uuid NOT NULL REFERENCES companies(id),
      doc_no            text NOT NULL,
      tally_type        text NOT NULL DEFAULT 'harvest',
      grow_cycle_id     uuid REFERENCES grow_cycles(id),
      supplier_id       uuid REFERENCES suppliers(id),
      destination_id    uuid REFERENCES branches(id),
      warehouse_id      uuid REFERENCES warehouses(id),
      transfer_date     date NOT NULL,
      reference_id      text,
      harvested_heads   numeric(14,4) DEFAULT 0,
      reject_kgs        numeric(14,4) DEFAULT 0,
      reject_heads      numeric(14,4) DEFAULT 0,
      replacement_kgs   numeric(14,4) DEFAULT 0,
      replacement_heads numeric(14,4) DEFAULT 0,
      net_heads         numeric(14,4) DEFAULT 0,
      net_kgs           numeric(14,4) DEFAULT 0,
      received_by       text,
      issued_by         text,
      checked_by        text,
      delivery_method   text,
      plate_number      text,
      driver            text,
      helper            text,
      start_time        time,
      end_time          time,
      remarks           text,
      status            text NOT NULL DEFAULT 'saved',
      created_by        uuid,
      posted_by         uuid,
      posted_at         timestamptz,
      created_at        timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`tally_sheet_lines`, `CREATE TABLE IF NOT EXISTS tally_sheet_lines (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tally_sheet_id  uuid NOT NULL REFERENCES tally_sheets(id) ON DELETE CASCADE,
      line_no         int NOT NULL,
      item_id         uuid NOT NULL REFERENCES items(id),
      heads           numeric(14,4) DEFAULT 0,
      gross_kgs       numeric(14,4) DEFAULT 0,
      crate_kgs       numeric(14,4) DEFAULT 0,
      net_kgs         numeric(14,4) DEFAULT 0,
      avg_weight      numeric(10,4),
      remarks         text
    )`],
    [`conversions`, `CREATE TABLE IF NOT EXISTS conversions (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       uuid NOT NULL REFERENCES companies(id),
      doc_no           text NOT NULL,
      branch_id        uuid REFERENCES branches(id),
      warehouse_id     uuid REFERENCES warehouses(id),
      transaction_date date NOT NULL,
      tally_sheet_id   uuid REFERENCES tally_sheets(id),
      source_item_id   uuid NOT NULL REFERENCES items(id),
      source_heads     numeric(14,4) DEFAULT 0,
      source_kgs       numeric(14,4) DEFAULT 0,
      remarks          text,
      status           text NOT NULL DEFAULT 'saved',
      total_output_kgs numeric(14,4) DEFAULT 0,
      yield_pct        numeric(5,2),
      created_by       uuid,
      posted_by        uuid,
      posted_at        timestamptz,
      created_at       timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`conversion_outputs`, `CREATE TABLE IF NOT EXISTS conversion_outputs (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversion_id   uuid NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
      line_no         int NOT NULL,
      output_item_id  uuid NOT NULL REFERENCES items(id),
      heads           numeric(14,4) DEFAULT 0,
      kgs             numeric(14,4) DEFAULT 0,
      unit_cost       numeric(12,4) DEFAULT 0,
      total_cost      numeric(14,2) DEFAULT 0,
      remarks         text
    )`],
    [`sales_tally_sheets`, `CREATE TABLE IF NOT EXISTS sales_tally_sheets (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      uuid NOT NULL REFERENCES companies(id),
      doc_no          text NOT NULL,
      customer_id     uuid REFERENCES customers(id),
      branch_id       uuid REFERENCES branches(id),
      transfer_date   date NOT NULL,
      ref_no          text,
      delivery_ref_no text,
      received_by     text,
      issued_by       text,
      checked_by      text,
      start_time      time,
      end_time        time,
      delivery_method text,
      plate_number    text,
      driver          text,
      remarks         text,
      status          text NOT NULL DEFAULT 'saved',
      created_by      uuid,
      posted_at       timestamptz,
      created_at      timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`sales_tally_lines`, `CREATE TABLE IF NOT EXISTS sales_tally_lines (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sales_tally_id  uuid NOT NULL REFERENCES sales_tally_sheets(id) ON DELETE CASCADE,
      line_no         int NOT NULL,
      item_id         uuid NOT NULL REFERENCES items(id),
      heads           numeric(14,4) DEFAULT 0,
      gross_kgs       numeric(14,4) DEFAULT 0,
      crate_kgs       numeric(14,4) DEFAULT 0,
      net_kgs         numeric(14,4) DEFAULT 0,
      unit_price      numeric(12,4) DEFAULT 0,
      amount          numeric(14,2) DEFAULT 0
    )`],
    [`poultry_deliveries`, `CREATE TABLE IF NOT EXISTS poultry_deliveries (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       uuid NOT NULL REFERENCES companies(id),
      doc_no           text NOT NULL,
      customer_id      uuid NOT NULL REFERENCES customers(id),
      sales_tally_id   uuid REFERENCES sales_tally_sheets(id),
      conversion_id    uuid REFERENCES conversions(id),
      branch_id        uuid REFERENCES branches(id),
      warehouse_id     uuid REFERENCES warehouses(id),
      transaction_date date NOT NULL,
      reference_no     text,
      delivery_method  text,
      delivery_address text,
      commitment_date  date,
      plate_number     text,
      driver           text,
      remarks          text,
      status           text NOT NULL DEFAULT 'saved',
      total_heads      numeric(14,4) DEFAULT 0,
      total_kgs        numeric(14,4) DEFAULT 0,
      total_amount     numeric(14,2) DEFAULT 0,
      created_by       uuid,
      posted_by        uuid,
      posted_at        timestamptz,
      created_at       timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`poultry_delivery_lines`, `CREATE TABLE IF NOT EXISTS poultry_delivery_lines (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_id   uuid NOT NULL REFERENCES poultry_deliveries(id) ON DELETE CASCADE,
      line_no       int NOT NULL,
      item_id       uuid NOT NULL REFERENCES items(id),
      heads         numeric(14,4) DEFAULT 0,
      kgs           numeric(14,4) DEFAULT 0,
      unit_price    numeric(12,4) DEFAULT 0,
      discount_pct  numeric(5,2) DEFAULT 0,
      amount        numeric(14,2) DEFAULT 0,
      remarks       text
    )`],
    [`poultry_invoices`, `CREATE TABLE IF NOT EXISTS poultry_invoices (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      uuid NOT NULL REFERENCES companies(id),
      doc_no          text NOT NULL,
      delivery_id     uuid REFERENCES poultry_deliveries(id),
      customer_id     uuid NOT NULL REFERENCES customers(id),
      invoice_date    date NOT NULL,
      due_date        date,
      payment_terms   int DEFAULT 30,
      subtotal        numeric(14,2) DEFAULT 0,
      vat_amount      numeric(14,2) DEFAULT 0,
      total_amount    numeric(14,2) DEFAULT 0,
      paid_amount     numeric(14,2) DEFAULT 0,
      balance_due     numeric(14,2) DEFAULT 0,
      payment_status  text DEFAULT 'unpaid',
      status          text NOT NULL DEFAULT 'draft',
      remarks         text,
      created_by      uuid,
      posted_by       uuid,
      posted_at       timestamptz,
      created_at      timestamptz DEFAULT now(),
      UNIQUE (company_id, doc_no)
    )`],
    [`poultry_invoice_lines`, `CREATE TABLE IF NOT EXISTS poultry_invoice_lines (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id    uuid NOT NULL REFERENCES poultry_invoices(id) ON DELETE CASCADE,
      line_no       int NOT NULL,
      item_id       uuid NOT NULL REFERENCES items(id),
      description   text,
      heads         numeric(14,4) DEFAULT 0,
      kgs           numeric(14,4) DEFAULT 0,
      unit_price    numeric(12,4) DEFAULT 0,
      discount_pct  numeric(5,2) DEFAULT 0,
      amount        numeric(14,2) DEFAULT 0,
      vat_rate      numeric(5,2) DEFAULT 12
    )`],
    [`poultry_inventory_ledger`, `CREATE TABLE IF NOT EXISTS poultry_inventory_ledger (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id       uuid NOT NULL REFERENCES companies(id),
      warehouse_id     uuid REFERENCES warehouses(id),
      item_id          uuid NOT NULL REFERENCES items(id),
      batch_id         uuid REFERENCES chick_batches(id),
      movement_type    text NOT NULL,
      source_type      text NOT NULL,
      source_id        uuid NOT NULL,
      source_doc_no    text,
      transaction_date date NOT NULL,
      heads_in         numeric(14,4) DEFAULT 0,
      heads_out        numeric(14,4) DEFAULT 0,
      kgs_in           numeric(14,4) DEFAULT 0,
      kgs_out          numeric(14,4) DEFAULT 0,
      unit_cost        numeric(12,4) DEFAULT 0,
      total_cost       numeric(14,2) DEFAULT 0,
      balance_heads    numeric(14,4) DEFAULT 0,
      balance_kgs      numeric(14,4) DEFAULT 0,
      created_at       timestamptz DEFAULT now()
    )`],
    [`poultry_inventory_balance`, `CREATE TABLE IF NOT EXISTS poultry_inventory_balance (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id    uuid NOT NULL REFERENCES companies(id),
      warehouse_id  uuid REFERENCES warehouses(id),
      item_id       uuid NOT NULL REFERENCES items(id),
      qty_heads     numeric(14,4) DEFAULT 0,
      qty_kgs       numeric(14,4) DEFAULT 0,
      avg_cost      numeric(12,4) DEFAULT 0,
      last_updated  timestamptz DEFAULT now(),
      UNIQUE (company_id, warehouse_id, item_id)
    )`],
  ] as [string, string][];

  for (const [tbl, sql] of poultryTables) {
    try {
      await query(sql);
      results.push(`021 ${tbl}: ok`);
    } catch (e) { results.push(`021 ${tbl}: ${(e as Error).message}`); }
  }

  // 021 — document_series for poultry modules
  const poultryDocTypes: Record<string, string> = {
    order_in:          'OI-',
    inventory_in:      'II-',
    grow_cycle:        'GR-',
    tally_sheet:       'TS-',
    conversion:        'CV-',
    sales_tally:       'ST-',
    poultry_delivery:  'PD-',
    poultry_invoice:   'PI-',
  };
  for (const [docType, prefix] of Object.entries(poultryDocTypes)) {
    try {
      await query(
        `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
         SELECT c.id, $1::varchar, ($2 || to_char(now(), 'YYYY') || '-')::varchar, 1, 0
         FROM companies c
         WHERE NOT EXISTS (SELECT 1 FROM document_series ds WHERE ds.company_id = c.id AND ds.doc_type = $1::varchar)`,
        [docType, prefix],
      );
      results.push(`021 doc_series ${docType}: ok`);
    } catch (e) { results.push(`021 doc_series ${docType}: ${(e as Error).message}`); }
  }

  // 022 — Grow Cycle extended fields
  const grow022 = [
    `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS grow_reference text`,
    `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS approx_heads numeric(14,4) DEFAULT 0`,
    `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS chick_price_per_head numeric(14,6) DEFAULT 0`,
    `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS approx_chick_price_per_head numeric(14,6) DEFAULT 0`,
    `ALTER TABLE grow_cycles ADD COLUMN IF NOT EXISTS culling_qty numeric(14,4) DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS grow_daily_mortality (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      grow_cycle_id uuid NOT NULL REFERENCES grow_cycles(id) ON DELETE CASCADE,
      day_no        int NOT NULL,
      qty           numeric(14,4) DEFAULT 0,
      UNIQUE (grow_cycle_id, day_no)
    )`,
    `CREATE TABLE IF NOT EXISTS grow_weekly_weights (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      grow_cycle_id uuid NOT NULL REFERENCES grow_cycles(id) ON DELETE CASCADE,
      week_no       int NOT NULL,
      weight_kg     numeric(10,4) DEFAULT 0,
      UNIQUE (grow_cycle_id, week_no)
    )`,
    `CREATE TABLE IF NOT EXISTS grow_item_consumption (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      grow_cycle_id uuid NOT NULL REFERENCES grow_cycles(id) ON DELETE CASCADE,
      line_no       int NOT NULL,
      item_id       uuid NOT NULL REFERENCES items(id),
      quantity      numeric(14,4) DEFAULT 0,
      uom           text DEFAULT 'bags',
      unit_cost     numeric(12,4) DEFAULT 0,
      total_cost    numeric(14,2) DEFAULT 0,
      remarks       text
    )`,
  ];
  for (const sql of grow022) {
    const label = sql.trim().split(/\s+/).slice(0, 5).join(' ').substring(0, 50);
    try { await query(sql); results.push(`022 ${label}: ok`); }
    catch (e) { results.push(`022 ${label}: ${(e as Error).message}`); }
  }

  // 023 — Master Data: departments + grow_references
  const master023 = [
    [`departments`, `CREATE TABLE IF NOT EXISTS departments (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  uuid NOT NULL REFERENCES companies(id),
      code        text NOT NULL,
      name        text NOT NULL,
      description text,
      is_active   boolean DEFAULT true,
      created_at  timestamptz DEFAULT now(),
      UNIQUE (company_id, code)
    )`],
    [`grow_references`, `CREATE TABLE IF NOT EXISTS grow_references (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  uuid NOT NULL REFERENCES companies(id),
      code        text NOT NULL,
      name        text NOT NULL,
      description text,
      is_active   boolean DEFAULT true,
      created_at  timestamptz DEFAULT now(),
      UNIQUE (company_id, code)
    )`],
  ] as [string, string][];
  for (const [tbl, sql] of master023) {
    try { await query(sql); results.push(`023 ${tbl}: ok`); }
    catch (e) { results.push(`023 ${tbl}: ${(e as Error).message}`); }
  }

  // 024 — Link chick_batches to GRN and PO
  const chick024 = [
    `ALTER TABLE chick_batches ADD COLUMN IF NOT EXISTS grn_id        uuid REFERENCES goods_receipts(id)`,
    `ALTER TABLE chick_batches ADD COLUMN IF NOT EXISTS grn_line_id   uuid REFERENCES goods_receipt_lines(id)`,
    `ALTER TABLE chick_batches ADD COLUMN IF NOT EXISTS po_id         uuid REFERENCES purchase_orders(id)`,
    `ALTER TABLE chick_batches ADD COLUMN IF NOT EXISTS price_per_head numeric(14,6) DEFAULT 0`,
    `ALTER TABLE grow_cycles   ADD COLUMN IF NOT EXISTS po_id         uuid REFERENCES purchase_orders(id)`,
    `ALTER TABLE grow_cycles   ADD COLUMN IF NOT EXISTS grn_id        uuid REFERENCES goods_receipts(id)`,
  ];
  for (const sql of chick024) {
    const label = sql.trim().split(/\s+/).slice(0, 6).join(' ').substring(0, 60);
    try { await query(sql); results.push(`024 ${label}: ok`); }
    catch (e) { results.push(`024 ${label}: ${(e as Error).message}`); }
  }

  // 025 — Poultry master data: farm buildings + grow references
  try {
    await query(`
      INSERT INTO farm_buildings (id, company_id, branch_id, code, name, capacity_heads, building_type, is_active) VALUES
        ('mmmm0001-0000-0000-0000-000000000001', $1, '22222222-2222-2222-2222-222222222202', 'BLD-A', 'Building A', 5000, 'broiler', true),
        ('mmmm0001-0000-0000-0000-000000000002', $1, '22222222-2222-2222-2222-222222222202', 'BLD-B', 'Building B', 5000, 'broiler', true),
        ('mmmm0001-0000-0000-0000-000000000003', $1, '22222222-2222-2222-2222-222222222203', 'BLD-C', 'Building C', 3000, 'broiler', true),
        ('mmmm0001-0000-0000-0000-000000000004', $1, '22222222-2222-2222-2222-222222222203', 'BLD-D', 'Building D', 3000, 'broiler', true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('025 farm_buildings: ok');
  } catch (e) { results.push(`025 farm_buildings: ${(e as Error).message}`); }

  try {
    await query(`
      INSERT INTO grow_references (id, company_id, code, name, description, is_active) VALUES
        ('nnnn0001-0000-0000-0000-000000000001', $1, 'GR-001', 'Grow 1', 'First grow cycle of the season',  true),
        ('nnnn0001-0000-0000-0000-000000000002', $1, 'GR-002', 'Grow 2', 'Second grow cycle of the season', true),
        ('nnnn0001-0000-0000-0000-000000000003', $1, 'GR-003', 'Grow 3', 'Third grow cycle of the season',  true)
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('025 grow_references: ok');
  } catch (e) { results.push(`025 grow_references: ${(e as Error).message}`); }

  // 026 — Sample purchase orders for chick procurement (approved, ready to receive)
  try {
    await query(`
      INSERT INTO purchase_orders
        (id, company_id, branch_id, po_no, supplier_id, po_date, expected_date,
         subtotal, vat_amount, total, status, created_by)
      SELECT
        v.id::uuid, $1, $2,
        v.po_no,
        (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1),
        v.po_date::date, v.exp_date::date,
        v.sub::numeric, v.vat::numeric, v.tot::numeric,
        'received', $3
      FROM (VALUES
        ('pppp0001-0000-0000-0000-000000000001','PO-2026-000001','TEST-S001','2026-04-01','2026-04-05', 225000.00, 27000.00, 252000.00),
        ('pppp0001-0000-0000-0000-000000000002','PO-2026-000002','TEST-S001','2026-04-08','2026-04-12', 126000.00, 15120.00, 141120.00)
      ) AS v(id, po_no, scode, po_date, exp_date, sub, vat, tot)
      WHERE (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('026 purchase_orders: ok');
  } catch (e) { results.push(`026 purchase_orders: ${(e as Error).message}`); }

  try {
    await query(`
      INSERT INTO purchase_order_lines
        (id, po_id, line_no, item_id, description, quantity, qty_received, unit_price, subtotal, vat_amount, total)
      SELECT
        v.id::uuid, v.po_id::uuid, v.ln::int,
        (SELECT id FROM items WHERE company_id = $1 AND sku = v.sku LIMIT 1),
        v.dsc, v.qty::numeric, v.qty::numeric, v.price::numeric, v.sub::numeric, v.vat::numeric, v.tot::numeric
      FROM (VALUES
        ('pppp0002-0000-0000-0000-000000000001','pppp0001-0000-0000-0000-000000000001',1,'DOC-ROSS308','Ross 308 Day-Old Chicks',5000,45.00,225000.00,27000.00,252000.00),
        ('pppp0002-0000-0000-0000-000000000002','pppp0001-0000-0000-0000-000000000002',1,'DOC-COBB500','Cobb 500 Day-Old Chicks',3000,42.00,126000.00,15120.00,141120.00)
      ) AS v(id, po_id, ln, sku, dsc, qty, price, sub, vat, tot)
      WHERE (SELECT id FROM items WHERE company_id = $1 AND sku = v.sku LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('026 po_lines: ok');
  } catch (e) { results.push(`026 po_lines: ${(e as Error).message}`); }

  // 027 — Posted goods receipts for the sample POs (creates chick batches)
  try {
    await query(`
      INSERT INTO goods_receipts
        (id, company_id, grn_no, po_id, warehouse_id, receipt_date, delivery_no, status, posted_at, created_by)
      SELECT
        v.id::uuid, $1, v.grn_no, v.po_id::uuid,
        'bbbb0001-0000-0000-0000-000000000001',
        v.rx_date::date, v.dr_no, 'posted', v.rx_date::date, $2
      FROM (VALUES
        ('gggg0001-0000-0000-0000-000000000001','GRN-2026-000001','pppp0001-0000-0000-0000-000000000001','2026-04-05','AVIAGEN-DR-0501'),
        ('gggg0001-0000-0000-0000-000000000002','GRN-2026-000002','pppp0001-0000-0000-0000-000000000002','2026-04-12','AVIAGEN-DR-0512')
      ) AS v(id, grn_no, po_id, rx_date, dr_no)
      ON CONFLICT DO NOTHING`, [CO, USR]);
    results.push('027 goods_receipts: ok');
  } catch (e) { results.push(`027 goods_receipts: ${(e as Error).message}`); }

  try {
    await query(`
      INSERT INTO goods_receipt_lines (id, grn_id, po_line_id, line_no, qty_received, unit_cost)
      VALUES
        ('hhhh0001-0000-0000-0000-000000000001',
         'gggg0001-0000-0000-0000-000000000001',
         'pppp0002-0000-0000-0000-000000000001',
         1, 5000, 45.00),
        ('hhhh0001-0000-0000-0000-000000000002',
         'gggg0001-0000-0000-0000-000000000002',
         'pppp0002-0000-0000-0000-000000000002',
         1, 3000, 42.00)
      ON CONFLICT DO NOTHING`);
    results.push('027 grn_lines: ok');
  } catch (e) { results.push(`027 grn_lines: ${(e as Error).message}`); }

  // Chick batches — auto-created when GRN is posted (seeded directly to match posted GRNs)
  try {
    await query(`
      INSERT INTO chick_batches
        (id, company_id, batch_no, grn_id, grn_line_id, po_id, item_id,
         heads_in, heads_available, price_per_head, date_received, status)
      SELECT
        v.id::uuid, $1, v.batch_no, v.grn_id::uuid, v.grn_line_id::uuid, v.po_id::uuid,
        (SELECT id FROM items WHERE company_id = $1 AND sku = v.sku LIMIT 1),
        v.heads::numeric, v.heads::numeric, v.price::numeric, v.rx_date::date, 'available'
      FROM (VALUES
        ('kkkk0001-0000-0000-0000-000000000001','BATCH-2026-00001',
         'gggg0001-0000-0000-0000-000000000001','hhhh0001-0000-0000-0000-000000000001',
         'pppp0001-0000-0000-0000-000000000001','DOC-ROSS308',5000,45.00,'2026-04-05'),
        ('kkkk0001-0000-0000-0000-000000000002','BATCH-2026-00002',
         'gggg0001-0000-0000-0000-000000000002','hhhh0001-0000-0000-0000-000000000002',
         'pppp0001-0000-0000-0000-000000000002','DOC-COBB500',3000,42.00,'2026-04-12')
      ) AS v(id, batch_no, grn_id, grn_line_id, po_id, sku, heads, price, rx_date)
      WHERE (SELECT id FROM items WHERE company_id = $1 AND sku = v.sku LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO]);
    results.push('027 chick_batches: ok');
  } catch (e) { results.push(`027 chick_batches: ${(e as Error).message}`); }

  // Customers — use code prefix TEST-C so they don't conflict with API-generated CUST-xxxxxx
  try {
    await query(`
      INSERT INTO customers (id, company_id, code, name, customer_type, tin, address, contact_person, email, phone, payment_terms_days, credit_limit, is_active) VALUES
        ('dddd0001-0000-0000-0000-000000000001', $1, 'TEST-C001', 'Bounty Agro Ventures Inc.',  'wholesale', '123-456-789-000', 'Cainta, Rizal',     'Ramon Cruz',    'ramon@bounty.com',  '09171234567', 30,  500000, true),
        ('dddd0001-0000-0000-0000-000000000002', $1, 'TEST-C002', 'Magnolia Inc.',              'wholesale', '987-654-321-000', 'Mandaluyong City',  'Cathy Reyes',   'cathy@magnolia.com','09281234567', 15, 1000000, true),
        ('dddd0001-0000-0000-0000-000000000003', $1, 'TEST-C003', 'Metro Wet Market Assoc.',   'trade',     '111-222-333-000', 'Divisoria, Manila', 'Nestor Garcia', 'nestor@mwm.com',    '09391234567', 7,   250000, true),
        ('dddd0001-0000-0000-0000-000000000004', $1, 'TEST-C004', 'Jollibee Foods Corp.',      'wholesale', '444-555-666-000', 'Ortigas, Pasig',    'Karen Santos',  'karen@jfc.com',     '09451234567', 30, 2000000, true),
        ('dddd0001-0000-0000-0000-000000000005', $1, 'TEST-C005', 'SM Supermarket Inc.',       'wholesale', '777-888-999-000', 'SM Mall of Asia',   'Leo Tan',       'leo@sm.com.ph',     '09561234567', 30, 3000000, true)
      ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`, [CO]);
    results.push('seed customers: ok');
  } catch (e) { results.push(`seed customers: ${(e as Error).message}`); }

  // Suppliers — no credit_limit column on suppliers table
  try {
    await query(`
      INSERT INTO suppliers (id, company_id, code, name, supplier_type, tin, address, contact_person, email, phone, payment_terms_days, is_active) VALUES
        ('eeee0001-0000-0000-0000-000000000001', $1, 'TEST-S001', 'Aviagen Philippines Inc.',    'trade', '000-111-222-000', 'Laguna Technopark, Biñan',   'Sales Team',     'sales@aviagen.ph',   '025551001', 30, true),
        ('eeee0001-0000-0000-0000-000000000002', $1, 'TEST-S002', 'Cargill Philippines Inc.',    'trade', '000-222-333-000', 'Bonifacio Global City',      'Feed Sales',     'feed@cargill.ph',    '025551002', 30, true),
        ('eeee0001-0000-0000-0000-000000000003', $1, 'TEST-S003', 'San Miguel Foods Inc.',       'trade', '000-333-444-000', 'San Fernando, Pampanga',     'Accounts Mgr',   'accts@smfi.com',     '025551003', 30, true),
        ('eeee0001-0000-0000-0000-000000000004', $1, 'TEST-S004', 'Intervet Philippines Inc.',   'trade', '000-444-555-000', 'Makati City',                'Vet Sales',      'vet@intervet.ph',    '025551004', 15, true)
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
        ('ffff0001-0000-0000-0000-000000000001','SI-2026-000001','TEST-C001','2026-04-10','2026-05-10',30,133928.57,16071.43,150000.00,      0,150000.00,'open'),
        ('ffff0001-0000-0000-0000-000000000002','SI-2026-000002','TEST-C002','2026-04-15','2026-04-30',15,267857.14,32142.86,300000.00,100000,200000.00,'partially_paid'),
        ('ffff0001-0000-0000-0000-000000000003','SI-2026-000003','TEST-C003','2026-03-15','2026-04-14', 7, 44642.86, 5357.14, 50000.00,      0, 50000.00,'overdue'),
        ('ffff0001-0000-0000-0000-000000000004','SI-2026-000004','TEST-C004','2026-05-01','2026-05-31',30,446428.57,53571.43,500000.00,      0,500000.00,'open'),
        ('ffff0001-0000-0000-0000-000000000005','SI-2026-000005','TEST-C001','2026-04-20','2026-04-30',10, 89285.71,10714.29,100000.00,100000,      0,'paid')
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
      SELECT v.inv_id::uuid, v.line_no::int, v.item_id::uuid, v.dsc, v.qty::numeric, v.price::numeric, 0, 12, v.sub::numeric, v.vat::numeric, v.tot::numeric
      FROM (VALUES
        ('ffff0001-0000-0000-0000-000000000001',1,'cccc0001-0000-0000-0000-000000000007','Live Broiler Chicken',1163.79,115.00,133928.57,16071.43,150000.00),
        ('ffff0001-0000-0000-0000-000000000002',1,'cccc0001-0000-0000-0000-000000000007','Live Broiler Chicken',2329.19,115.00,267857.14,32142.86,300000.00),
        ('ffff0001-0000-0000-0000-000000000003',1,'cccc0001-0000-0000-0000-000000000007','Live Broiler Chicken', 387.93,115.00, 44642.86, 5357.14, 50000.00),
        ('ffff0001-0000-0000-0000-000000000004',1,'cccc0001-0000-0000-0000-000000000008','Dressed Chicken',    2547.97,175.00,446428.57,53571.43,500000.00),
        ('ffff0001-0000-0000-0000-000000000005',1,'cccc0001-0000-0000-0000-000000000007','Live Broiler Chicken', 775.59,115.00, 89285.71,10714.29,100000.00)
      ) AS v(inv_id, line_no, item_id, dsc, qty, price, sub, vat, tot)
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
        ('a1b20001-0000-0000-0000-000000000001','AVIAGEN-INV-001','BL-2026-000001','TEST-S001','2026-04-01','2026-05-01', 357142.86, 42857.14, 400000.00,400000,       0,'approved'),
        ('a1b20001-0000-0000-0000-000000000002','AVIAGEN-INV-002','BL-2026-000002','TEST-S001','2026-04-10','2026-05-10', 223214.29, 26785.71, 250000.00,     0,250000.00,'approved'),
        ('a1b20001-0000-0000-0000-000000000003','CARGILL-INV-001','BL-2026-000003','TEST-S002','2026-04-05','2026-05-05', 446428.57, 53571.43, 500000.00,200000,300000.00,'approved')
      ) AS v(id, bill_no, internal_no, scode, bill_date, due_date, subtotal, vat, total, paid, bal, status)
      WHERE (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1) IS NOT NULL
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed bills: ok');
  } catch (e) { results.push(`seed bills: ${(e as Error).message}`); }

  // Bill lines (table is `bill_lines`)
  try {
    await query(`
      INSERT INTO bill_lines (bill_id, line_no, item_id, description, quantity, unit_price, vat_rate, line_subtotal, line_vat, line_total)
      SELECT v.bill_id::uuid, v.ln::int, v.item_id::uuid, v.dsc, v.qty::numeric, v.price::numeric, 12, v.sub::numeric, v.vat::numeric, v.tot::numeric
      FROM (VALUES
        ('a1b20001-0000-0000-0000-000000000001',1,'cccc0001-0000-0000-0000-000000000001','Ross 308 Day-Old Chicks', 5000, 63.78, 318900.00, 38268.00, 357168.00),
        ('a1b20001-0000-0000-0000-000000000002',1,'cccc0001-0000-0000-0000-000000000001','Ross 308 Day-Old Chicks', 3000, 66.96, 200880.00, 24105.60, 224985.60),
        ('a1b20001-0000-0000-0000-000000000003',1,'cccc0001-0000-0000-0000-000000000003','Starter Mash (50kg bag)',  500,800.00, 400000.00, 48000.00, 448000.00)
      ) AS v(bill_id, ln, item_id, dsc, qty, price, sub, vat, tot)
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
         'Sales invoice SI-2026-000001 - Bounty Agro Ventures', 'ar', 'posted', '2026-04-10 08:00:00+08', $3, $3),
        ('a1b40001-0000-0000-0000-000000000002', $1, $2, 'JV-2026-000002', '2026-04-15',
         'Sales invoice SI-2026-000002 - Magnolia Inc.', 'ar', 'posted', '2026-04-15 08:00:00+08', $3, $3)
      ON CONFLICT DO NOTHING`, [CO, HO, USR]);
    results.push('seed journal_entries: ok');
  } catch (e) { results.push(`seed journal_entries: ${(e as Error).message}`); }

  // Advance document_series counters past seeded data so new docs don't collide
  // sales_invoices seeded: SI-2026-000001..000005 → current_number must be >= 5
  // official_receipts seeded: OR-2026-000001..000002 → current_number must be >= 2
  // journal_voucher seeded: JV-2026-000001..000002 → current_number must be >= 2
  const seriesFloors: [string, number][] = [
    ['sales_invoice',   5],
    ['official_receipt', 2],
    ['journal_voucher',  2],
  ];
  for (const [docType, floor] of seriesFloors) {
    try {
      await query(
        `UPDATE document_series SET current_number = GREATEST(current_number, $2) WHERE doc_type = $1 AND current_number < $2`,
        [docType, floor],
      );
      results.push(`document_series floor ${docType}=${floor}: ok`);
    } catch (e) { results.push(`document_series floor ${docType}: ${(e as Error).message}`); }
  }

  // --- 018: EWT columns on bill_lines + BIR 2307 table ---
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS wht_certificates (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id      uuid NOT NULL REFERENCES companies(id),
        cert_no         varchar(30) NOT NULL,
        bill_id         uuid NOT NULL REFERENCES bills(id),
        supplier_id     uuid NOT NULL REFERENCES suppliers(id),
        bir_atc_code    varchar(10) NOT NULL,
        taxable_amount  numeric(18,2) NOT NULL,
        rate_pct        numeric(6,4) NOT NULL,
        amount_withheld numeric(18,2) NOT NULL,
        period_year     int NOT NULL,
        period_quarter  int NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
        status          varchar(20) NOT NULL DEFAULT 'draft',
        issued_at       timestamptz,
        filed_at        timestamptz,
        created_by      uuid NOT NULL REFERENCES users(id),
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, cert_no)
      )
    `);
    results.push('018 wht_certificates: ok');
  } catch (e) { results.push(`018 wht_certificates: ${(e as Error).message}`); }

  try {
    await query(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bir_atc_code varchar(10)`);
    results.push('018 suppliers.bir_atc_code: ok');
  } catch (e) { results.push(`018 suppliers.bir_atc_code: ${(e as Error).message}`); }

  // --- 018: EWT columns on bill_lines ---
  try {
    await query(`ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS ewt_rate numeric(5,2) NOT NULL DEFAULT 0`);
    results.push('018 bill_lines.ewt_rate: ok');
  } catch (e) { results.push(`018 bill_lines.ewt_rate: ${(e as Error).message}`); }
  try {
    await query(`ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS ewt_amount numeric(18,2) NOT NULL DEFAULT 0`);
    results.push('018 bill_lines.ewt_amount: ok');
  } catch (e) { results.push(`018 bill_lines.ewt_amount: ${(e as Error).message}`); }

  // ================================================================
  // 019: BIR tax codes + EWT sample data
  // ================================================================

  // Full EWT + VAT tax code set
  try {
    await query(`
      INSERT INTO tax_codes (company_id, code, name, tax_type, rate_pct, bir_atc_code, is_active) VALUES
        ($1, 'VAT12-OUT',  'Output VAT 12%',                                       'vat_output',  12.0000, NULL,    true),
        ($1, 'VAT12-IN',   'Input VAT 12%',                                        'vat_input',   12.0000, NULL,    true),
        ($1, 'VAT0-OUT',   'Zero-rated Sales (0%)',                                'vat_output',   0.0000, NULL,    true),
        ($1, 'VAT-EXEMPT', 'VAT-Exempt Transactions',                              'vat_output',   0.0000, NULL,    true),
        ($1, 'EWT-1',      'EWT 1% — Supplier of Goods (WC158)',                   'ewt',          1.0000, 'WC158', true),
        ($1, 'EWT-2',      'EWT 2% — Supplier of Services (WC160)',                'ewt',          2.0000, 'WC160', true),
        ($1, 'EWT-5R',     'EWT 5% — Rental of Real/Personal Property (WC100)',    'ewt',          5.0000, 'WC100', true),
        ($1, 'EWT-5P',     'EWT 5% — Payments to Brokers / Agents (WC120)',        'ewt',          5.0000, 'WC120', true),
        ($1, 'EWT-10C',    'EWT 10% — Commission to Corporations (WC180)',         'ewt',         10.0000, 'WC180', true),
        ($1, 'EWT-10I',    'EWT 10% — Commission to Individuals (WI180)',          'ewt',         10.0000, 'WI180', true),
        ($1, 'EWT-15C',    'EWT 15% — Professional Fees to Corporations (WC010)',  'ewt',         15.0000, 'WC010', true),
        ($1, 'EWT-15I',    'EWT 15% — Professional Fees to Individuals (WI010)',   'ewt',         15.0000, 'WI010', true),
        ($1, 'EWT-20',     'EWT 20% — Royalties / Interest (WC050)',               'ewt',         20.0000, 'WC050', true),
        ($1, 'EWT-2C',     'EWT 2% — General Engineering Contractors (WC200)',     'ewt',          2.0000, 'WC200', true),
        ($1, 'EWT-1P',     'EWT 1% — Payments by Credit Card Companies (WC250)',   'ewt',          1.0000, 'WC250', true)
      ON CONFLICT (company_id, code) DO UPDATE
        SET name = EXCLUDED.name, bir_atc_code = EXCLUDED.bir_atc_code
    `, [CO]);
    results.push('019 tax_codes EWT+VAT: ok');
  } catch (e) { results.push(`019 tax_codes: ${(e as Error).message}`); }

  // Update suppliers with specific EWT rates + ATC codes
  try {
    await query(`
      UPDATE suppliers SET ewt_rate = 1.00, bir_atc_code = 'WC158'
       WHERE company_id = $1 AND code IN ('TEST-S001','TEST-S002','TEST-S003','TEST-S004')
         AND ewt_rate = 1.00
    `, [CO]);
    results.push('019 supplier ewt defaults: ok');
  } catch (e) { results.push(`019 supplier ewt defaults: ${(e as Error).message}`); }

  // Back-fill EWT on seeded bills and their lines (1% of subtotal each)
  try {
    await query(`
      UPDATE bills
         SET ewt_amount = ROUND(subtotal * 0.01, 2)
       WHERE id IN (
         'a1b20001-0000-0000-0000-000000000001',
         'a1b20001-0000-0000-0000-000000000002',
         'a1b20001-0000-0000-0000-000000000003'
       ) AND ewt_amount = 0
    `);
    results.push('019 bills ewt backfill: ok');
  } catch (e) { results.push(`019 bills ewt backfill: ${(e as Error).message}`); }

  try {
    await query(`
      UPDATE bill_lines
         SET ewt_rate   = 1.00,
             ewt_amount = ROUND(line_subtotal * 0.01, 2)
       WHERE bill_id IN (
         'a1b20001-0000-0000-0000-000000000001',
         'a1b20001-0000-0000-0000-000000000002',
         'a1b20001-0000-0000-0000-000000000003'
       ) AND ewt_rate = 0
    `);
    results.push('019 bill_lines ewt backfill: ok');
  } catch (e) { results.push(`019 bill_lines ewt backfill: ${(e as Error).message}`); }

  // Seed wht_certificates for each approved seeded bill
  try {
    await query(`
      INSERT INTO wht_certificates
        (id, company_id, cert_no, bill_id, supplier_id, bir_atc_code,
         taxable_amount, rate_pct, amount_withheld, period_year, period_quarter, status, created_by)
      SELECT
        v.cert_id::uuid, $1, v.cert_no, v.bill_id::uuid,
        (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1),
        'WC158',
        v.gross::numeric, 1.0000, v.withheld::numeric,
        v.yr::int, v.qtr::int, v.status, $2
      FROM (VALUES
        ('a1b50001-0000-0000-0000-000000000001','2307-2026-Q2-00001','a1b20001-0000-0000-0000-000000000001','TEST-S001',2232142.86, 22321.43, 2026, 2,'issued'),
        ('a1b50001-0000-0000-0000-000000000002','2307-2026-Q2-00002','a1b20001-0000-0000-0000-000000000002','TEST-S002', 892857.14,  8928.57, 2026, 2,'draft'),
        ('a1b50001-0000-0000-0000-000000000003','2307-2026-Q1-00001','a1b20001-0000-0000-0000-000000000003','TEST-S003', 178571.43,  1785.71, 2026, 1,'draft')
      ) AS v(cert_id, cert_no, bill_id, scode, gross, withheld, yr, qtr, status)
      WHERE (SELECT id FROM suppliers WHERE company_id = $1 AND code = v.scode LIMIT 1) IS NOT NULL
        AND EXISTS (SELECT 1 FROM bills WHERE id = v.bill_id::uuid)
      ON CONFLICT (company_id, cert_no) DO NOTHING
    `, [CO, USR]);
    results.push('019 wht_certificates: ok');
  } catch (e) { results.push(`019 wht_certificates: ${(e as Error).message}`); }

  // --- 020a: Add purchase_variance_account_id to items ---
  try {
    await query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_variance_account_id uuid REFERENCES accounts(id)`);
    results.push('020a items.purchase_variance_account_id: ok');
  } catch (e) { results.push(`020a items.purchase_variance_account_id: ${(e as Error).message}`); }

  // --- 020: Updated Chart of Accounts (5-digit codes) ---
  try {
    const COA_COMPANY = '11111111-1111-1111-1111-111111111111';
    await query(`
      INSERT INTO accounts (company_id, code, name, account_type, is_control)
      VALUES
        -- Current Assets: Cash and Cash Equivalents
        ($1,'10040','Cash in Bank - Social Custodian (0031)',      'ASSET',false),
        ($1,'10045','Cash in Bank - BDO Fillment Account (0762)',  'ASSET',false),
        ($1,'10060','Cash in Bank - SBC (9932)',                   'ASSET',false),
        ($1,'10075','Cash in Bank - BDO Ayala Rockville (1780)',   'ASSET',false),
        ($1,'10090','Cash in Bank - SBC Dollar Account (678-1)',   'ASSET',false),
        ($1,'10501','Petty Cash Fund',                             'ASSET',false),
        ($1,'10502','Revolving Fund',                              'ASSET',false),
        ($1,'11000','Undisputed Funds',                            'ASSET',false),
        -- Current Assets: Trade and Other Receivables
        ($1,'11001','Accounts Receivable',                                    'ASSET',true),
        ($1,'11012','Accounts Receivable - Others',                           'ASSET',false),
        ($1,'11015','Advances to Officers and Employees - Operations',        'ASSET',false),
        ($1,'11016','Advances to Officers and Employees - H.O',               'ASSET',false),
        ($1,'11017','Advances to Liquidation',                                'ASSET',false),
        ($1,'11018','Advances to Related Parties',                            'ASSET',false),
        ($1,'11019','Advances to Stockholders',                               'ASSET',false),
        ($1,'11020','Other Receivables',                                      'ASSET',false),
        ($1,'11039','Due From BBQ',                                           'ASSET',false),
        ($1,'12001','Goods Invoiced Not Yet Received',                        'ASSET',false),
        -- Current Assets: Inventories
        ($1,'12005','LPG',                               'ASSET',false),
        ($1,'12020','Live Inventory',                    'ASSET',false),
        ($1,'12021','Dressed Chicken',                   'ASSET',false),
        ($1,'12022','By Products',                       'ASSET',false),
        ($1,'12023','Chicks',                            'ASSET',false),
        ($1,'12024','Feeds',                             'ASSET',false),
        ($1,'12025','Medicine',                          'ASSET',false),
        ($1,'12026','Fly Control',                       'ASSET',false),
        ($1,'12027','Vaccine',                           'ASSET',false),
        ($1,'12028','Tolling Fee',                       'ASSET',false),
        ($1,'12029','Other Live Inventory',              'ASSET',false),
        ($1,'12030','RM Inventory - Packaging Supplies', 'ASSET',false),
        ($1,'12031','RM Inventory - Food',               'ASSET',false),
        ($1,'12032','Fuel Inventory - Diesel',           'ASSET',false),
        ($1,'12102','Eggs',                              'ASSET',false),
        -- Current Assets: Other Current Assets
        ($1,'13001','Prepaid Expenses',                 'ASSET',false),
        ($1,'13004','Input VAT',                        'ASSET',true),
        ($1,'13005','Deferred Input VAT - Current',     'ASSET',false),
        ($1,'13006','Creditable Withholding Taxes',     'ASSET',false),
        ($1,'13007','Creditable Withholding Tax - VAT', 'ASSET',false),
        -- Noncurrent Assets: Property and Equipment
        ($1,'14001','Land - cost',                       'ASSET',false),
        ($1,'14003','Land Improvements - cost',          'ASSET',false),
        ($1,'14004','Building - cost',                   'ASSET',false),
        ($1,'14005','Leasehold Improvement',             'ASSET',false),
        ($1,'14008','Construction in Progress',          'ASSET',false),
        ($1,'14009','Machinery Equipment',               'ASSET',false),
        ($1,'14010','Transportation Equipment',          'ASSET',false),
        ($1,'14012','Station Tools and Equipment',       'ASSET',false),
        ($1,'14014','Furniture and Fixtures',            'ASSET',false),
        ($1,'14015','Office Equipment',                  'ASSET',false),
        ($1,'14016','Computer Equipment',                'ASSET',false),
        ($1,'14017','Computer Software and Development', 'ASSET',false),
        ($1,'15001','Franchise',                         'ASSET',false),
        -- Noncurrent Assets: Accumulated Depreciation
        ($1,'14501','Accumulated Depreciation - Land Improvements',         'ASSET',false),
        ($1,'14502','Accumulated Depreciation - Building',                  'ASSET',false),
        ($1,'14503','Accumulated Depreciation - Leasehold Improvements',    'ASSET',false),
        ($1,'14504','Accumulated Depreciation - Machinery Equipment',       'ASSET',false),
        ($1,'14507','Accumulated Depreciation - Transportation Equipment',  'ASSET',false),
        ($1,'14508','Accumulated Depreciation - Station Tools and Equipment','ASSET',false),
        ($1,'14510','Accumulated Depreciation - Furniture and Fixtures',    'ASSET',false),
        ($1,'14511','Accumulated Depreciation - Office Equipment',          'ASSET',false),
        ($1,'14512','Accumulated Depreciation - Computer Equipment',        'ASSET',false),
        ($1,'14521','Accumulated Amortization - Franchise Fees',            'ASSET',false),
        -- Noncurrent Assets: Other Noncurrent Assets
        ($1,'15010','Deferred Input VAT - Noncurrent', 'ASSET',false),
        ($1,'15011','Refundable Deposits',             'ASSET',false),
        ($1,'15014','Prepaid Rent',                    'ASSET',false),
        -- Current Liabilities
        ($1,'20001','Accounts Payable - Trade',              'LIABILITY',true),
        ($1,'20011','Accounts Payable - Others',             'LIABILITY',false),
        ($1,'20013','Advances from Customers',               'LIABILITY',false),
        ($1,'20014','Output VAT',                            'LIABILITY',true),
        ($1,'20015','Advances from Stockholders',            'LIABILITY',false),
        ($1,'20016','Goods Received Not Yet Invoiced',       'LIABILITY',false),
        ($1,'20017','Accrued Expenses',                      'LIABILITY',false),
        ($1,'20019','SSS Premium Payable',                   'LIABILITY',false),
        ($1,'20020','SSS Loan Payable',                      'LIABILITY',false),
        ($1,'20021','Philhealth Premium Payable',            'LIABILITY',false),
        ($1,'20023','Pag-Ibig Premium Payable',              'LIABILITY',false),
        ($1,'20025','Pag-Ibig Loan Payable',                 'LIABILITY',false),
        ($1,'20026','Loan Payable - Current',                'LIABILITY',false),
        ($1,'20027','Loan Payable - AFCC',                   'LIABILITY',false),
        ($1,'20028','Replenishment Fund - AFCC',             'LIABILITY',false),
        ($1,'20029','Reimbursement - AFCC',                  'LIABILITY',false),
        ($1,'20030','Withholding Tax Payable - Compensation','LIABILITY',false),
        ($1,'20031','Withholding Tax Payable - Expanded',    'LIABILITY',false),
        -- Non-Current Liabilities
        ($1,'21006','Deposits for Future Stock Subscription','LIABILITY',false),
        ($1,'21007','Loan Payable - Non-Current',            'LIABILITY',false),
        ($1,'21008','Deferred Tax Liability',                'LIABILITY',false),
        ($1,'21009','Income Tax Payable',                    'LIABILITY',false),
        -- Capital and Reserves
        ($1,'30001','Capital Stock',    'EQUITY',false),
        ($1,'30005','Opening Balances', 'EQUITY',false),
        -- Sales / Revenue
        ($1,'40001','Sales - Fruits',                    'REVENUE',false),
        ($1,'40002','Distribution',                      'REVENUE',false),
        ($1,'40004','Sales - Live Chicken',              'REVENUE',false),
        ($1,'40005','Sales - Five Star',                 'REVENUE',false),
        ($1,'40009','Logistic',                          'REVENUE',false),
        ($1,'40014','Sales',                             'REVENUE',false),
        ($1,'40015','Sales Discount',                    'REVENUE',false),
        ($1,'40016','Fair Value Adjustment on Livestock','REVENUE',false),
        ($1,'40027','Service Revenue',                   'REVENUE',false),
        ($1,'40030','Sales - Dressed Chicken',           'REVENUE',false),
        ($1,'40031','Sales - By Products',               'REVENUE',false),
        ($1,'40035','Sales Discount - PWD',              'REVENUE',false),
        ($1,'40036','Sales Discount - Senior Citizen',   'REVENUE',false),
        -- Direct Cost / Cost of Sales
        ($1,'50001','Day Old Chicken',                   'EXPENSE',false),
        ($1,'50002','Live Buying',                       'EXPENSE',false),
        ($1,'50003','Feeds',                             'EXPENSE',false),
        ($1,'50004','Tolling Fees',                      'EXPENSE',false),
        ($1,'50005','Medicines',                         'EXPENSE',false),
        ($1,'50006','Vaccines',                          'EXPENSE',false),
        ($1,'50023','Freight Charges',                   'EXPENSE',false),
        ($1,'50026','Cost of Sales - Dressed Chicken',   'EXPENSE',false),
        ($1,'50028','Loading Fee',                       'EXPENSE',false),
        ($1,'50029','Fly Control Fee',                   'EXPENSE',false),
        ($1,'50030','Harvest Fee',                       'EXPENSE',false),
        ($1,'50031','Cleaning Fee',                      'EXPENSE',false),
        ($1,'50032','Other Direct Costs',                'EXPENSE',false),
        ($1,'50033','Gas',                               'EXPENSE',false),
        ($1,'50034','Incentives',                        'EXPENSE',false),
        ($1,'50037','Hauling - Salaries',                'EXPENSE',false),
        ($1,'50038','Hauling - Gas and Oil',             'EXPENSE',false),
        ($1,'50039','Hauling - Freight Charge',          'EXPENSE',false),
        ($1,'50040','CDS - Fivestar',                    'EXPENSE',false),
        ($1,'50041','Eggs',                              'EXPENSE',false),
        ($1,'50044','Depreciation Expense',              'EXPENSE',false),
        ($1,'50056','Cost of Sales - Service Charge',    'EXPENSE',false),
        ($1,'50057','Cost of Sales - Food',              'EXPENSE',false),
        ($1,'50058','Cost of Sales - Remuneration',      'EXPENSE',false),
        -- Operating Cost: Salaries and Related Expenses
        ($1,'60001','Salaries and Wages - Headquarter',  'EXPENSE',false),
        ($1,'60002','Salaries and Wages - Operations',   'EXPENSE',false),
        ($1,'60003','13th Month Bonus',                  'EXPENSE',false),
        ($1,'60005','SSS Premium Contribution',          'EXPENSE',false),
        ($1,'60006','Philhealth Premium Contribution',   'EXPENSE',false),
        ($1,'60007','Pag-Ibig Premium Contribution',     'EXPENSE',false),
        ($1,'60008','Employees Benefits',                'EXPENSE',false),
        ($1,'60009','Retirement Expense',                'EXPENSE',false),
        -- Operating Cost: Premises and Utilities
        ($1,'61001','Rental Expense',                    'EXPENSE',false),
        ($1,'61002','Light and Water',                   'EXPENSE',false),
        -- Operating Cost: Transportation and Travel
        ($1,'62001','Transportation Expense',            'EXPENSE',false),
        ($1,'62002','Gas and Oil',                       'EXPENSE',false),
        ($1,'62003','Courier Services',                  'EXPENSE',false),
        ($1,'62004','Toll Fees',                         'EXPENSE',false),
        -- Operating Cost: Advertising and Representation
        ($1,'62007','Seminars and Trainings',            'EXPENSE',false),
        ($1,'63002','Representation Expense',            'EXPENSE',false),
        -- Operating Cost: Depreciation and Amortization
        ($1,'64001','Depreciation Expense',              'EXPENSE',false),
        ($1,'64002','Amortization Expense',              'EXPENSE',false),
        -- Operating Cost: Other Expenses
        ($1,'66002','Bank Charges',                      'EXPENSE',false),
        ($1,'66011','Insurance',                         'EXPENSE',false),
        ($1,'66012','Interest Expense',                  'EXPENSE',false),
        ($1,'66017','Membership and Dues',               'EXPENSE',false),
        ($1,'66018','Office Supplies',                   'EXPENSE',false),
        ($1,'66020','Processing Costs',                  'EXPENSE',false),
        ($1,'66021','Professional Fees',                 'EXPENSE',false),
        ($1,'66022','Repairs and Maintenance',           'EXPENSE',false),
        ($1,'66023','Seminars and Trainings',            'EXPENSE',false),
        ($1,'66024','Station Supplies',                  'EXPENSE',false),
        ($1,'66025','Taxes and Licenses',                'EXPENSE',false),
        ($1,'66026','Telephone and Communication',       'EXPENSE',false),
        ($1,'67000','Miscellaneous Expense',             'EXPENSE',false),
        ($1,'67001','Farm Supplies',                     'EXPENSE',false),
        ($1,'70003','Input VAT - Non-Applicable to Exempt Sales','EXPENSE',false),
        -- Other Income
        ($1,'70001','Interest Income',                   'REVENUE',false),
        ($1,'70002','Other Income - Commercial Growing', 'REVENUE',false),
        ($1,'70010','Other Income - Income at Operator', 'REVENUE',false)
      ON CONFLICT (company_id, code) DO UPDATE
        SET name         = EXCLUDED.name,
            account_type = EXCLUDED.account_type,
            is_control   = EXCLUDED.is_control
    `, [COA_COMPANY]);
    results.push('020 chart_of_accounts upsert: ok');
  } catch (e) { results.push(`020 chart_of_accounts FAILED: ${(e as Error).message}`); }

  // Deactivate legacy 4-digit accounts that are no longer in use
  try {
    const COA_COMPANY = '11111111-1111-1111-1111-111111111111';
    await query(`
      UPDATE accounts
         SET is_active = false
       WHERE company_id = $1
         AND length(code) = 4
         AND is_active = true
    `, [COA_COMPANY]);
    results.push('020 legacy 4-digit accounts deactivated: ok');
  } catch (e) { results.push(`020 legacy deactivate FAILED: ${(e as Error).message}`); }

  // 028 — Link order_ins to purchase_orders
  try {
    await query(`ALTER TABLE order_ins ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id)`);
    results.push('028 order_ins.purchase_order_id: ok');
  } catch (e) { results.push(`028 order_ins.purchase_order_id: ${(e as Error).message}`); }

  // 029 — P&L tagging columns: branch, building, cost_center, grow_reference on all transactional tables
  const tag029: [string, string][] = [
    ['purchase_orders.building_id',      `ALTER TABLE purchase_orders     ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['purchase_orders.cost_center_id',   `ALTER TABLE purchase_orders     ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['purchase_orders.grow_reference_id',`ALTER TABLE purchase_orders     ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['bills.branch_id',                  `ALTER TABLE bills               ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES branches(id)`],
    ['bills.building_id',                `ALTER TABLE bills               ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['bills.cost_center_id',             `ALTER TABLE bills               ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['bills.grow_reference_id',          `ALTER TABLE bills               ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['supplier_payments.branch_id',      `ALTER TABLE supplier_payments   ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES branches(id)`],
    ['supplier_payments.building_id',    `ALTER TABLE supplier_payments   ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['supplier_payments.cost_center_id', `ALTER TABLE supplier_payments   ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['supplier_payments.grow_ref_id',    `ALTER TABLE supplier_payments   ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['goods_receipts.branch_id',         `ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS branch_id         uuid REFERENCES branches(id)`],
    ['goods_receipts.building_id',       `ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['goods_receipts.cost_center_id',    `ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['goods_receipts.grow_ref_id',       `ALTER TABLE goods_receipts      ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['sales_orders.building_id',         `ALTER TABLE sales_orders        ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['sales_orders.cost_center_id',      `ALTER TABLE sales_orders        ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['sales_orders.grow_reference_id',   `ALTER TABLE sales_orders        ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['sales_invoices.building_id',       `ALTER TABLE sales_invoices      ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['sales_invoices.cost_center_id',    `ALTER TABLE sales_invoices      ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['sales_invoices.grow_reference_id', `ALTER TABLE sales_invoices      ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['customer_payments.building_id',    `ALTER TABLE customer_payments   ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['customer_payments.cost_center_id', `ALTER TABLE customer_payments   ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['customer_payments.grow_ref_id',    `ALTER TABLE customer_payments   ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
  ];
  for (const [label, sql] of tag029) {
    try { await query(sql); results.push(`029 ${label}: ok`); }
    catch (e) { results.push(`029 ${label}: ${(e as Error).message}`); }
  }

  // 030 — grow_reference_id on all line-item tables for per-line P&L tagging
  const lineTags030: [string, string][] = [
    ['purchase_order_lines.grow_reference_id', `ALTER TABLE purchase_order_lines  ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['bill_lines.grow_reference_id',           `ALTER TABLE bill_lines            ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['sales_order_lines.grow_reference_id',    `ALTER TABLE sales_order_lines     ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['sales_invoice_lines.grow_reference_id',  `ALTER TABLE sales_invoice_lines   ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['goods_receipt_lines.grow_reference_id',  `ALTER TABLE goods_receipt_lines   ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
  ];
  for (const [label, sql] of lineTags030) {
    try { await query(sql); results.push(`030 ${label}: ok`); }
    catch (e) { results.push(`030 ${label}: ${(e as Error).message}`); }
  }

  // 031 — purchase_orders tagging columns + GL line support
  const po031: [string, string][] = [
    ['purchase_orders.remarks',            `ALTER TABLE purchase_orders       ADD COLUMN IF NOT EXISTS remarks          text`],
    ['purchase_orders.building_id',        `ALTER TABLE purchase_orders       ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['purchase_orders.cost_center_id',     `ALTER TABLE purchase_orders       ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['purchase_orders.grow_reference_id',  `ALTER TABLE purchase_orders       ADD COLUMN IF NOT EXISTS grow_reference_id uuid REFERENCES grow_references(id)`],
    ['purchase_order_lines.branch_id',     `ALTER TABLE purchase_order_lines  ADD COLUMN IF NOT EXISTS branch_id        uuid REFERENCES branches(id)`],
    ['purchase_order_lines.building_id',   `ALTER TABLE purchase_order_lines  ADD COLUMN IF NOT EXISTS building_id      uuid REFERENCES farm_buildings(id)`],
    ['purchase_order_lines.cost_center_id',`ALTER TABLE purchase_order_lines  ADD COLUMN IF NOT EXISTS cost_center_id   uuid REFERENCES cost_centers(id)`],
    ['purchase_order_lines.gl_account_id', `ALTER TABLE purchase_order_lines  ADD COLUMN IF NOT EXISTS gl_account_id    uuid REFERENCES accounts(id)`],
    ['purchase_order_lines.item_id nullable', `ALTER TABLE purchase_order_lines ALTER COLUMN item_id DROP NOT NULL`],
  ];
  for (const [label, sql] of po031) {
    try { await query(sql); results.push(`031 ${label}: ok`); }
    catch (e) { results.push(`031 ${label}: ${(e as Error).message}`); }
  }

  // 032 — update admin user credentials
  try {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('artfresh2026', 10);
    await query(
      `UPDATE users SET email = $1, password_hash = $2 WHERE email IN ($1, 'admin@perpet.com.ph')`,
      ['admin@afcc.ph', hash],
    );
    results.push('032 admin credentials: ok');
  } catch (e) { results.push(`032 admin credentials: ${(e as Error).message}`); }

  // 033 — employees table
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS employees (
        id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
        user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
        employee_no      varchar(30) NOT NULL,
        full_name        varchar(200) NOT NULL,
        email            varchar(200),
        phone            varchar(50),
        department_id    uuid REFERENCES departments(id) ON DELETE SET NULL,
        position         varchar(100),
        employment_type  varchar(20) NOT NULL DEFAULT 'full_time'
                           CHECK (employment_type IN ('full_time','part_time','contractual','probationary')),
        hire_date        date,
        end_date         date,
        is_active        boolean NOT NULL DEFAULT true,
        notes            text,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, employee_no)
      )
    `);
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'employees_updated') THEN
          CREATE TRIGGER employees_updated BEFORE UPDATE ON employees
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_employees_company ON employees (company_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_employees_user ON employees (user_id)`);
    results.push('033 employees table: ok');
  } catch (e) { results.push(`033 employees FAILED: ${(e as Error).message}`); }

  // 034 — EWT code linkage on bills + suppliers.bir_atc_code
  try {
    await query(`ALTER TABLE bills       ADD COLUMN IF NOT EXISTS ewt_code_id  uuid REFERENCES tax_codes(id)`);
    results.push('034 bills.ewt_code_id: ok');
  } catch (e) { results.push(`034 bills.ewt_code_id FAILED: ${(e as Error).message}`); }

  try {
    await query(`ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_rate    numeric(5,2)  DEFAULT 0`);
    results.push('034 bill_lines.ewt_rate: ok');
  } catch (e) { results.push(`034 bill_lines.ewt_rate FAILED: ${(e as Error).message}`); }

  try {
    await query(`ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_amount  numeric(18,2) DEFAULT 0`);
    results.push('034 bill_lines.ewt_amount: ok');
  } catch (e) { results.push(`034 bill_lines.ewt_amount FAILED: ${(e as Error).message}`); }

  try {
    await query(`ALTER TABLE bill_lines  ADD COLUMN IF NOT EXISTS ewt_code_id uuid REFERENCES tax_codes(id)`);
    results.push('034 bill_lines.ewt_code_id: ok');
  } catch (e) { results.push(`034 bill_lines.ewt_code_id FAILED: ${(e as Error).message}`); }

  try {
    await query(`ALTER TABLE suppliers   ADD COLUMN IF NOT EXISTS bir_atc_code varchar(10)`);
    results.push('034 suppliers.bir_atc_code: ok');
  } catch (e) { results.push(`034 suppliers.bir_atc_code FAILED: ${(e as Error).message}`); }

  // 035 — item document series (format: ITEM000001)
  try {
    await query(
      `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
       SELECT c.id, 'item', 'ITEM', 1, 0
       FROM companies c
       WHERE NOT EXISTS (SELECT 1 FROM document_series ds WHERE ds.company_id = c.id AND ds.doc_type = 'item')`,
    );
    results.push('035 document_series item: ok');
  } catch (e) { results.push(`035 document_series item FAILED: ${(e as Error).message}`); }

  // 036 — je_id column on goods_receipts
  try {
    await query(`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS je_id uuid REFERENCES journal_entries(id)`);
    results.push('036 goods_receipts.je_id: ok');
  } catch (e) { results.push(`036 goods_receipts.je_id FAILED: ${(e as Error).message}`); }

  // 036b — seed "Advances to Suppliers" account for all companies (used when billing a PO with no GR)
  try {
    await query(
      `INSERT INTO accounts (company_id, code, name, account_type, is_control, is_active)
       SELECT c.id, '11021', 'Advances to Suppliers', 'ASSET', false, true
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts a
          WHERE a.company_id = c.id
            AND (a.code = '11021'
                 OR a.name ILIKE '%advances to supplier%'
                 OR (a.name ILIKE '%advance%' AND a.name ILIKE '%supplier%'))
       )`,
    );
    results.push('036 advances_to_suppliers account: ok');
  } catch (e) { results.push(`036 advances_to_suppliers account FAILED: ${(e as Error).message}`); }

  // 038 — mark inventory GL accounts as control accounts (prevents manual JE posting)
  try {
    await query(
      `UPDATE accounts SET is_control = true
        WHERE is_active = true
          AND account_type = 'ASSET'
          AND (code = '1200' OR name ILIKE '%merchandise inventory%' OR name ILIKE '%finished goods inventory%' OR name ILIKE '%raw materials inventory%')
          AND is_control = false`,
    );
    results.push('038 inventory control accounts: ok');
  } catch (e) { results.push(`038 inventory control accounts: ${(e as Error).message}`); }

  // 037 — branch/building/cost_center on sales_order_lines and sales_invoice_lines
  const lineTags037: [string, string][] = [
    ['sales_order_lines.branch_id',       `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS branch_id       uuid REFERENCES branches(id)`],
    ['sales_order_lines.building_id',     `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS building_id     uuid REFERENCES farm_buildings(id)`],
    ['sales_order_lines.cost_center_id',  `ALTER TABLE sales_order_lines    ADD COLUMN IF NOT EXISTS cost_center_id  uuid REFERENCES cost_centers(id)`],
    ['sales_invoice_lines.branch_id',     `ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS branch_id       uuid REFERENCES branches(id)`],
    ['sales_invoice_lines.building_id',   `ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS building_id     uuid REFERENCES farm_buildings(id)`],
    ['sales_invoice_lines.cost_center_id',`ALTER TABLE sales_invoice_lines  ADD COLUMN IF NOT EXISTS cost_center_id  uuid REFERENCES cost_centers(id)`],
  ];
  for (const [label, sql] of lineTags037) {
    try { await query(sql); results.push(`037 ${label}: ok`); }
    catch (e) { results.push(`037 ${label}: ${(e as Error).message}`); }
  }

  return ok({ results });
}
