-- 002_chart_of_accounts.sql
-- Chart of Accounts for Perpet Pilipinas Corp.
-- 5-digit account code convention:
--   1xxxx Assets  |  2xxxx Liabilities  |  3xxxx Capital and Reserves
--   4xxxx Sales/Revenue  |  5xxxx Direct Cost  |  6xxxx Operating Cost  |  7xxxx Other Income
--
-- NOTE: This replaces the previous 4-digit COA. Old 4-digit accounts that no longer
--       exist here should be deactivated manually via: UPDATE accounts SET is_active = false
--       WHERE company_id = '11111111-...' AND length(code) = 4;

WITH ppc AS (SELECT '11111111-1111-1111-1111-111111111111'::uuid AS id)
INSERT INTO accounts (company_id, code, name, account_type, is_control)
SELECT ppc.id, x.code, x.name, x.account_type, x.is_control FROM ppc, (VALUES

  -- ================================================================
  -- ASSETS
  -- ================================================================

  -- Current Assets: Cash and Cash Equivalents
  ('10040', 'Cash in Bank - Social Custodian (0031)',       'ASSET', false),
  ('10045', 'Cash in Bank - BDO Fillment Account (0762)',   'ASSET', false),
  ('10060', 'Cash in Bank - SBC (9932)',                    'ASSET', false),
  ('10075', 'Cash in Bank - BDO Ayala Rockville (1780)',    'ASSET', false),
  ('10090', 'Cash in Bank - SBC Dollar Account (678-1)',    'ASSET', false),
  ('10501', 'Petty Cash Fund',                              'ASSET', false),
  ('10502', 'Revolving Fund',                               'ASSET', false),
  ('11000', 'Undisputed Funds',                             'ASSET', false),

  -- Current Assets: Trade and Other Receivables
  ('11001', 'Accounts Receivable',                                     'ASSET', true),
  ('11012', 'Accounts Receivable - Others',                            'ASSET', false),
  ('11015', 'Advances to Officers and Employees - Operations',         'ASSET', false),
  ('11016', 'Advances to Officers and Employees - H.O',                'ASSET', false),
  ('11017', 'Advances to Liquidation',                                 'ASSET', false),
  ('11018', 'Advances to Related Parties',                             'ASSET', false),
  ('11019', 'Advances to Stockholders',                                'ASSET', false),
  ('11020', 'Other Receivables',                                       'ASSET', false),
  ('11039', 'Due From BBQ',                                            'ASSET', false),
  ('12001', 'Goods Invoiced Not Yet Received',                         'ASSET', false),

  -- Current Assets: Inventories
  ('12005', 'LPG',                              'ASSET', false),
  ('12020', 'Live Inventory',                   'ASSET', false),
  ('12021', 'Dressed Chicken',                  'ASSET', false),
  ('12022', 'By Products',                      'ASSET', false),
  ('12023', 'Chicks',                           'ASSET', false),
  ('12024', 'Feeds',                            'ASSET', false),
  ('12025', 'Medicine',                         'ASSET', false),
  ('12026', 'Fly Control',                      'ASSET', false),
  ('12027', 'Vaccine',                          'ASSET', false),
  ('12028', 'Tolling Fee',                      'ASSET', false),
  ('12029', 'Other Live Inventory',             'ASSET', false),
  ('12030', 'RM Inventory - Packaging Supplies','ASSET', false),
  ('12031', 'RM Inventory - Food',              'ASSET', false),
  ('12032', 'Fuel Inventory - Diesel',          'ASSET', false),
  ('12102', 'Eggs',                             'ASSET', false),

  -- Current Assets: Other Current Assets
  ('13001', 'Prepaid Expenses',                 'ASSET', false),
  ('13004', 'Input VAT',                        'ASSET', true),
  ('13005', 'Deferred Input VAT - Current',     'ASSET', false),
  ('13006', 'Creditable Withholding Taxes',     'ASSET', false),
  ('13007', 'Creditable Withholding Tax - VAT', 'ASSET', false),

  -- Noncurrent Assets: Property and Equipment
  ('14001', 'Land - cost',                       'ASSET', false),
  ('14003', 'Land Improvements - cost',          'ASSET', false),
  ('14004', 'Building - cost',                   'ASSET', false),
  ('14005', 'Leasehold Improvement',             'ASSET', false),
  ('14008', 'Construction in Progress',          'ASSET', false),
  ('14009', 'Machinery Equipment',               'ASSET', false),
  ('14010', 'Transportation Equipment',          'ASSET', false),
  ('14012', 'Station Tools and Equipment',       'ASSET', false),
  ('14014', 'Furniture and Fixtures',            'ASSET', false),
  ('14015', 'Office Equipment',                  'ASSET', false),
  ('14016', 'Computer Equipment',               'ASSET', false),
  ('14017', 'Computer Software and Development', 'ASSET', false),
  ('15001', 'Franchise',                         'ASSET', false),

  -- Noncurrent Assets: Accumulated Depreciation and Amortization
  ('14501', 'Accumulated Depreciation - Land Improvements',       'ASSET', false),
  ('14502', 'Accumulated Depreciation - Building',                'ASSET', false),
  ('14503', 'Accumulated Depreciation - Leasehold Improvements',  'ASSET', false),
  ('14504', 'Accumulated Depreciation - Machinery Equipment',     'ASSET', false),
  ('14507', 'Accumulated Depreciation - Transportation Equipment','ASSET', false),
  ('14508', 'Accumulated Depreciation - Station Tools and Equipment','ASSET', false),
  ('14510', 'Accumulated Depreciation - Furniture and Fixtures',  'ASSET', false),
  ('14511', 'Accumulated Depreciation - Office Equipment',        'ASSET', false),
  ('14512', 'Accumulated Depreciation - Computer Equipment',      'ASSET', false),
  ('14521', 'Accumulated Amortization - Franchise Fees',          'ASSET', false),

  -- Noncurrent Assets: Other Noncurrent Assets
  ('15010', 'Deferred Input VAT - Noncurrent', 'ASSET', false),
  ('15011', 'Refundable Deposits',             'ASSET', false),
  ('15014', 'Prepaid Rent',                    'ASSET', false),

  -- ================================================================
  -- LIABILITIES
  -- ================================================================

  -- Current Liabilities: Trade and Other Payables
  ('20001', 'Accounts Payable - Trade',              'LIABILITY', true),
  ('20011', 'Accounts Payable - Others',             'LIABILITY', false),
  ('20013', 'Advances from Customers',               'LIABILITY', false),
  ('20014', 'Output VAT',                            'LIABILITY', true),
  ('20015', 'Advances from Stockholders',            'LIABILITY', false),
  ('20016', 'Goods Received Not Yet Invoiced',       'LIABILITY', false),
  ('20017', 'Accrued Expenses',                      'LIABILITY', false),
  ('20019', 'SSS Premium Payable',                   'LIABILITY', false),
  ('20020', 'SSS Loan Payable',                      'LIABILITY', false),
  ('20021', 'Philhealth Premium Payable',            'LIABILITY', false),
  ('20023', 'Pag-Ibig Premium Payable',              'LIABILITY', false),
  ('20025', 'Pag-Ibig Loan Payable',                 'LIABILITY', false),
  ('20026', 'Loan Payable - Current',                'LIABILITY', false),
  ('20027', 'Loan Payable - AFCC',                   'LIABILITY', false),
  ('20028', 'Replenishment Fund - AFCC',             'LIABILITY', false),
  ('20029', 'Reimbursement - AFCC',                  'LIABILITY', false),
  ('20030', 'Withholding Tax Payable - Compensation','LIABILITY', false),
  ('20031', 'Withholding Tax Payable - Expanded',    'LIABILITY', false),

  -- Non-Current Liabilities
  ('21006', 'Deposits for Future Stock Subscription','LIABILITY', false),
  ('21007', 'Loan Payable - Non-Current',            'LIABILITY', false),
  ('21008', 'Deferred Tax Liability',                'LIABILITY', false),
  ('21009', 'Income Tax Payable',                    'LIABILITY', false),

  -- ================================================================
  -- CAPITAL AND RESERVES (Equity)
  -- ================================================================
  ('30001', 'Capital Stock',    'EQUITY', false),
  ('30005', 'Opening Balances', 'EQUITY', false),

  -- ================================================================
  -- SALES / REVENUE
  -- ================================================================
  ('40001', 'Sales - Fruits',                    'REVENUE', false),
  ('40002', 'Distribution',                      'REVENUE', false),
  ('40004', 'Sales - Live Chicken',              'REVENUE', false),
  ('40005', 'Sales - Five Star',                 'REVENUE', false),
  ('40009', 'Logistic',                          'REVENUE', false),
  ('40014', 'Sales',                             'REVENUE', false),
  ('40015', 'Sales Discount',                    'REVENUE', false),
  ('40016', 'Fair Value Adjustment on Livestock','REVENUE', false),
  ('40027', 'Service Revenue',                   'REVENUE', false),
  ('40030', 'Sales - Dressed Chicken',           'REVENUE', false),
  ('40031', 'Sales - By Products',               'REVENUE', false),
  ('40035', 'Sales Discount - PWD',              'REVENUE', false),
  ('40036', 'Sales Discount - Senior Citizen',   'REVENUE', false),

  -- ================================================================
  -- DIRECT COST / COST OF SALES
  -- ================================================================
  ('50001', 'Day Old Chicken',                   'EXPENSE', false),
  ('50002', 'Live Buying',                       'EXPENSE', false),
  ('50003', 'Feeds',                             'EXPENSE', false),
  ('50004', 'Tolling Fees',                      'EXPENSE', false),
  ('50005', 'Medicines',                         'EXPENSE', false),
  ('50006', 'Vaccines',                          'EXPENSE', false),
  ('50023', 'Freight Charges',                   'EXPENSE', false),
  ('50026', 'Cost of Sales - Dressed Chicken',   'EXPENSE', false),
  ('50028', 'Loading Fee',                       'EXPENSE', false),
  ('50029', 'Fly Control Fee',                   'EXPENSE', false),
  ('50030', 'Harvest Fee',                       'EXPENSE', false),
  ('50031', 'Cleaning Fee',                      'EXPENSE', false),
  ('50032', 'Other Direct Costs',                'EXPENSE', false),
  ('50033', 'Gas',                               'EXPENSE', false),
  ('50034', 'Incentives',                        'EXPENSE', false),
  ('50037', 'Hauling - Salaries',                'EXPENSE', false),
  ('50038', 'Hauling - Gas and Oil',             'EXPENSE', false),
  ('50039', 'Hauling - Freight Charge',          'EXPENSE', false),
  ('50040', 'CDS - Fivestar',                    'EXPENSE', false),
  ('50041', 'Eggs',                              'EXPENSE', false),
  ('50044', 'Depreciation Expense',              'EXPENSE', false),
  ('50056', 'Cost of Sales - Service Charge',    'EXPENSE', false),
  ('50057', 'Cost of Sales - Food',              'EXPENSE', false),
  ('50058', 'Cost of Sales - Remuneration',      'EXPENSE', false),

  -- ================================================================
  -- OPERATING COST
  -- ================================================================

  -- Salaries and Related Expenses
  ('60001', 'Salaries and Wages - Headquarter',  'EXPENSE', false),
  ('60002', 'Salaries and Wages - Operations',   'EXPENSE', false),
  ('60003', '13th Month Bonus',                  'EXPENSE', false),
  ('60005', 'SSS Premium Contribution',          'EXPENSE', false),
  ('60006', 'Philhealth Premium Contribution',   'EXPENSE', false),
  ('60007', 'Pag-Ibig Premium Contribution',     'EXPENSE', false),
  ('60008', 'Employees Benefits',                'EXPENSE', false),
  ('60009', 'Retirement Expense',                'EXPENSE', false),

  -- Premises and Utilities
  ('61001', 'Rental Expense',                    'EXPENSE', false),
  ('61002', 'Light and Water',                   'EXPENSE', false),

  -- Transportation and Travel
  ('62001', 'Transportation Expense',            'EXPENSE', false),
  ('62002', 'Gas and Oil',                       'EXPENSE', false),
  ('62003', 'Courier Services',                  'EXPENSE', false),
  ('62004', 'Toll Fees',                         'EXPENSE', false),

  -- Advertising and Representation
  ('62007', 'Seminars and Trainings',            'EXPENSE', false),
  ('63002', 'Representation Expense',            'EXPENSE', false),

  -- Depreciation and Amortization
  ('64001', 'Depreciation Expense',              'EXPENSE', false),
  ('64002', 'Amortization Expense',              'EXPENSE', false),

  -- Other Expenses
  ('66002', 'Bank Charges',                      'EXPENSE', false),
  ('66011', 'Insurance',                         'EXPENSE', false),
  ('66012', 'Interest Expense',                  'EXPENSE', false),
  ('66017', 'Membership and Dues',               'EXPENSE', false),
  ('66018', 'Office Supplies',                   'EXPENSE', false),
  ('66020', 'Processing Costs',                  'EXPENSE', false),
  ('66021', 'Professional Fees',                 'EXPENSE', false),
  ('66022', 'Repairs and Maintenance',           'EXPENSE', false),
  ('66023', 'Seminars and Trainings',            'EXPENSE', false),
  ('66024', 'Station Supplies',                  'EXPENSE', false),
  ('66025', 'Taxes and Licenses',                'EXPENSE', false),
  ('66026', 'Telephone and Communication',       'EXPENSE', false),
  ('67000', 'Miscellaneous Expense',             'EXPENSE', false),
  ('67001', 'Farm Supplies',                     'EXPENSE', false),
  ('70003', 'Input VAT - Non-Applicable to Exempt Sales', 'EXPENSE', false),

  -- ================================================================
  -- OTHER INCOME
  -- ================================================================
  ('70001', 'Interest Income',                   'REVENUE', false),
  ('70002', 'Other Income - Commercial Growing', 'REVENUE', false),
  ('70010', 'Other Income - Income at Operator', 'REVENUE', false)

) AS x(code, name, account_type, is_control)
ON CONFLICT (company_id, code) DO UPDATE
  SET name         = EXCLUDED.name,
      account_type = EXCLUDED.account_type,
      is_control   = EXCLUDED.is_control;
