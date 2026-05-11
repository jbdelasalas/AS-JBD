-- 001_demo_company.sql
-- Seed demo data for Perpet Pilipinas Corp.

-- Use a fixed UUID for the demo company so other seed files can reference it
INSERT INTO companies (id, code, name, legal_name, tin, rdo_code, address, base_currency)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'PPC',
  'Perpet Pilipinas Corp.',
  'Perpet Pilipinas Corporation',
  '000-000-000-000',           -- replace with real TIN
  '043',                        -- replace with real RDO code
  'Manila, Philippines',
  'PHP'
) ON CONFLICT (id) DO NOTHING;

-- Branches: head office + sample depot + sample retail station
INSERT INTO branches (id, company_id, code, name, branch_type, address) VALUES
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111', 'HO',    'Head Office',          'office',          'Manila'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111', 'DEPOT-CAL', 'Calamba Fuel Depot', 'depot',           'Calamba, Laguna'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111111', 'STN-001',   'Perpet Station SLEX',  'retail_station', 'SLEX, Calamba')
ON CONFLICT DO NOTHING;

-- Fiscal periods for 2026
INSERT INTO fiscal_periods (company_id, year, period, start_date, end_date, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 2026,  1, '2026-01-01', '2026-01-31', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  2, '2026-02-01', '2026-02-28', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  3, '2026-03-01', '2026-03-31', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  4, '2026-04-01', '2026-04-30', 'closed'),
  ('11111111-1111-1111-1111-111111111111', 2026,  5, '2026-05-01', '2026-05-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  6, '2026-06-01', '2026-06-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  7, '2026-07-01', '2026-07-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  8, '2026-08-01', '2026-08-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026,  9, '2026-09-01', '2026-09-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 10, '2026-10-01', '2026-10-31', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 11, '2026-11-01', '2026-11-30', 'open'),
  ('11111111-1111-1111-1111-111111111111', 2026, 12, '2026-12-01', '2026-12-31', 'open')
ON CONFLICT DO NOTHING;

-- BIR-controlled document series
INSERT INTO document_series (company_id, doc_type, prefix, start_number, end_number, current_number, bir_permit_no) VALUES
  ('11111111-1111-1111-1111-111111111111', 'sales_invoice',     'SI-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'official_receipt',  'OR-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'delivery_receipt',  'DR-2026-', 1, 9999, 0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'credit_memo',       'CM-2026-', 1, 999,  0, 'CAS-2026-XXX-0000'),
  ('11111111-1111-1111-1111-111111111111', 'journal_voucher',   'JV-2026-', 1, 9999, 0, NULL)
ON CONFLICT DO NOTHING;

-- Common PH tax codes
INSERT INTO tax_codes (company_id, code, name, tax_type, rate_pct, bir_atc_code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'VAT12-OUT',  'Output VAT 12%',                'vat_output',  12.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'VAT12-IN',   'Input VAT 12%',                 'vat_input',   12.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'VAT0-OUT',   'Zero-rated sales',              'vat_output',   0.0000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'EWT-1%',     'EWT 1% (goods)',                'ewt',          1.0000, 'WC158'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-2%',     'EWT 2% (services)',             'ewt',          2.0000, 'WC160'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-5%',     'EWT 5% (rentals)',              'ewt',          5.0000, 'WC100'),
  ('11111111-1111-1111-1111-111111111111', 'EWT-10%',    'EWT 10% (professional fees)',   'ewt',         10.0000, 'WC010')
ON CONFLICT DO NOTHING;
