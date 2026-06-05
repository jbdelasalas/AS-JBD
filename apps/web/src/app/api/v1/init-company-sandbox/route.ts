export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

// Copies a company + its users/roles from the public (production) schema into
// the sandbox schema, then seeds document_series, fiscal_periods, and
// app_settings. Does NOT copy master data (accounts, items, suppliers, etc.).
export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try { auth = await requireAuth(request); } catch (e) { return e as Response; }
  if (!auth.isSuperadmin) return err('Superadmin only', 403);

  const { company_id } = await request.json().catch(() => ({ company_id: '' }));
  if (!company_id) return err('company_id required', 400);

  const prod    = getPool(false); // public schema
  const sandbox = getPool(true);  // sandbox schema

  const results: string[] = [];

  // ── 1. Copy company record ─────────────────────────────────────────────────
  try {
    const { rows: [company] } = await prod.query(
      `SELECT id, code, name, trade_name, tin, vat_status, rdo_code, business_style,
              registered_address, registration_date, books_start_date,
              accounting_method, fiscal_year_start_month, is_active
         FROM companies WHERE id = $1`,
      [company_id],
    );
    if (!company) return err(`Company ${company_id} not found in production`, 404);

    await sandbox.query(
      `INSERT INTO companies (
         id, code, name, trade_name, tin, vat_status, rdo_code, business_style,
         registered_address, registration_date, books_start_date,
         accounting_method, fiscal_year_start_month, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name                    = EXCLUDED.name,
         trade_name              = EXCLUDED.trade_name,
         tin                     = EXCLUDED.tin,
         vat_status              = EXCLUDED.vat_status,
         rdo_code                = EXCLUDED.rdo_code,
         business_style          = EXCLUDED.business_style,
         registered_address      = EXCLUDED.registered_address,
         registration_date       = EXCLUDED.registration_date,
         books_start_date        = EXCLUDED.books_start_date,
         accounting_method       = EXCLUDED.accounting_method,
         fiscal_year_start_month = EXCLUDED.fiscal_year_start_month,
         is_active               = EXCLUDED.is_active`,
      [
        company.id, company.code, company.name, company.trade_name ?? null,
        company.tin ?? null, company.vat_status ?? null, company.rdo_code ?? null,
        company.business_style ?? null, company.registered_address ?? null,
        company.registration_date ?? null, company.books_start_date ?? null,
        company.accounting_method ?? 'ACCRUAL', company.fiscal_year_start_month ?? 1,
        company.is_active,
      ],
    );
    results.push(`company ${company.code}: ok`);
  } catch (e) { return err(`company copy failed: ${(e as Error).message}`, 500); }

  // ── 2. Copy users who have roles for this company ──────────────────────────
  try {
    const { rows: users } = await prod.query(
      `SELECT DISTINCT u.id, u.email, u.password_hash, u.full_name, u.is_active, u.is_superadmin
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.company_id = $1`,
      [company_id],
    );

    for (const u of users) {
      await sandbox.query(
        `INSERT INTO users (id, email, password_hash, full_name, is_active, is_superadmin)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           email         = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           full_name     = EXCLUDED.full_name,
           is_active     = EXCLUDED.is_active,
           is_superadmin = EXCLUDED.is_superadmin`,
        [u.id, u.email, u.password_hash, u.full_name, u.is_active, u.is_superadmin],
      );
    }
    results.push(`users (${users.length}): ok`);
  } catch (e) { results.push(`users failed: ${(e as Error).message}`); }

  // ── 3. Copy user_roles ─────────────────────────────────────────────────────
  try {
    const { rows: roles } = await prod.query(
      `SELECT id, user_id, company_id, role FROM user_roles WHERE company_id = $1`,
      [company_id],
    );

    for (const r of roles) {
      await sandbox.query(
        `INSERT INTO user_roles (id, user_id, company_id, role)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
        [r.id, r.user_id, r.company_id, r.role],
      );
    }
    results.push(`user_roles (${roles.length}): ok`);
  } catch (e) { results.push(`user_roles failed: ${(e as Error).message}`); }

  // ── 4. Copy branches ───────────────────────────────────────────────────────
  try {
    const { rows: branches } = await prod.query(
      `SELECT id, company_id, code, name, address, is_active
         FROM branches WHERE company_id = $1`,
      [company_id],
    );

    for (const b of branches) {
      await sandbox.query(
        `INSERT INTO branches (id, company_id, code, name, address, is_active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           code      = EXCLUDED.code,
           name      = EXCLUDED.name,
           address   = EXCLUDED.address,
           is_active = EXCLUDED.is_active`,
        [b.id, b.company_id, b.code, b.name, b.address ?? null, b.is_active],
      );
    }
    results.push(`branches (${branches.length}): ok`);
  } catch (e) { results.push(`branches failed: ${(e as Error).message}`); }

  // ── 5. Copy warehouses ─────────────────────────────────────────────────────
  try {
    const { rows: warehouses } = await prod.query(
      `SELECT id, company_id, code, name, address, is_active
         FROM warehouses WHERE company_id = $1`,
      [company_id],
    );

    for (const w of warehouses) {
      await sandbox.query(
        `INSERT INTO warehouses (id, company_id, code, name, address, is_active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           code      = EXCLUDED.code,
           name      = EXCLUDED.name,
           address   = EXCLUDED.address,
           is_active = EXCLUDED.is_active`,
        [w.id, w.company_id, w.code, w.name, w.address ?? null, w.is_active],
      );
    }
    results.push(`warehouses (${warehouses.length}): ok`);
  } catch (e) { results.push(`warehouses failed: ${(e as Error).message}`); }

  // ── 6. Seed document_series ────────────────────────────────────────────────
  const year = new Date().getFullYear();
  const docTypes: [string, string][] = [
    ['purchase_order',   `PO-${year}-`],
    ['goods_receipt',    `GRN-${year}-`],
    ['sales_order',      `SO-${year}-`],
    ['delivery_receipt', `DR-${year}-`],
    ['credit_memo',      `CM-${year}-`],
    ['official_receipt', `OR-${year}-`],
    ['journal_voucher',  `JV-${year}-`],
    ['order_in',         `OI-${year}-`],
    ['inventory_in',     `II-${year}-`],
    ['grow_cycle',       `GR-${year}-`],
    ['tally_sheet',      `TS-${year}-`],
    ['conversion',       `CV-${year}-`],
    ['sales_tally',      `ST-${year}-`],
    ['poultry_delivery', `PD-${year}-`],
    ['poultry_invoice',  `PI-${year}-`],
    ['bill',             `BILL-${year}-`],
    ['item',             'ITEM'],
  ];

  for (const [docType, prefix] of docTypes) {
    try {
      await sandbox.query(
        `INSERT INTO document_series (company_id, doc_type, prefix, start_number, current_number)
         VALUES ($1, $2, $3, 1, 0)
         ON CONFLICT DO NOTHING`,
        [company_id, docType, prefix],
      );
      results.push(`doc_series ${docType}: ok`);
    } catch (e) { results.push(`doc_series ${docType}: ${(e as Error).message}`); }
  }

  // ── 7. Seed fiscal_periods 2025–2027 ───────────────────────────────────────
  try {
    await sandbox.query(
      `INSERT INTO fiscal_periods (company_id, year, period, start_date, end_date, status)
       SELECT $1,
              y.yr,
              m.mo,
              make_date(y.yr, m.mo, 1),
              (make_date(y.yr, m.mo, 1) + interval '1 month - 1 day')::date,
              'open'
       FROM (VALUES (2025),(2026),(2027)) AS y(yr)
       CROSS JOIN generate_series(1,12) AS m(mo)
       WHERE NOT EXISTS (
         SELECT 1 FROM fiscal_periods fp
         WHERE fp.company_id = $1 AND fp.year = y.yr AND fp.period = m.mo
       )`,
      [company_id],
    );
    results.push('fiscal_periods 2025-2027: ok');
  } catch (e) { results.push(`fiscal_periods: ${(e as Error).message}`); }

  // ── 8. Seed app_settings ───────────────────────────────────────────────────
  for (const [key, value] of [['dark_mode','false'],['brand_theme','blue'],['login_bg',''],['company_name','']]) {
    try {
      await sandbox.query(
        `INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [key, value],
      );
    } catch { /* ignore */ }
  }
  results.push('app_settings: ok');

  return ok({ results });
}
