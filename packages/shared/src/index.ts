// Shared types used by both backend and frontend

// ================================================================
// PRIMITIVE / SHARED
// ================================================================
export type AccountTypeCode = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type JournalEntryStatus = 'draft' | 'pending' | 'posted' | 'voided';

export type DocStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'posted'
  | 'partial'
  | 'paid'
  | 'voided'
  | 'cancelled';

// ================================================================
// GL
// ================================================================
export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountTypeCode;
  parent_id: string | null;
  currency: string;
  is_active: boolean;
  is_control: boolean;
  description: string | null;
}

export interface JournalEntryLine {
  id?: string;
  line_no: number;
  account_id: string;
  account_code?: string;
  account_name?: string;
  description: string | null;
  debit: number;
  credit: number;
  currency: string;
  fx_rate: number;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  branch_id: string | null;
  entry_no: string;
  entry_date: string;
  fiscal_period_id: string | null;
  reference: string | null;
  memo: string | null;
  source_module: string;
  status: JournalEntryStatus;
  posted_at: string | null;
  posted_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: string;
  lines: JournalEntryLine[];
}

export interface CreateJournalEntryDto {
  entry_date: string;
  reference?: string;
  memo?: string;
  branch_id?: string;
  lines: Array<{
    account_id: string;
    description?: string;
    debit?: number;
    credit?: number;
  }>;
}

// ================================================================
// AUTH / USERS
// ================================================================
export interface User {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superadmin: boolean;
  twofa_enabled: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
  permissions: string[];
  companies: Array<{ id: string; code: string; name: string }>;
}

// ================================================================
// CUSTOMERS
// ================================================================
export type CustomerType = 'wholesale' | 'retail' | 'fleet' | 'gov';

export interface Customer {
  id: string;
  company_id: string;
  code: string;
  name: string;
  customer_type: CustomerType;
  tin: string | null;
  address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  payment_terms_days: number;
  credit_limit: number;
  is_vat_exempt: boolean;
  is_active: boolean;
  ar_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerDto {
  company_id: string;
  code?: string;
  name: string;
  customer_type?: CustomerType;
  tin?: string;
  address?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  payment_terms_days?: number;
  credit_limit?: number;
  is_vat_exempt?: boolean;
  ar_account_id?: string;
}

export interface UpdateCustomerDto extends Partial<Omit<CreateCustomerDto, 'company_id' | 'code'>> {}

// ================================================================
// SALES ORDERS
// ================================================================
export type SalesOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_delivered'
  | 'fully_delivered'
  | 'closed'
  | 'cancelled';

export interface SalesOrderLine {
  id: string;
  order_id: string;
  line_no: number;
  item_id: string;
  item_sku?: string;
  item_name?: string;
  description: string;
  quantity: number;
  qty_delivered: number;
  qty_reserved: number;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface SalesOrder {
  id: string;
  company_id: string;
  branch_id: string | null;
  order_no: string;
  customer_id: string;
  customer_name?: string;
  order_date: string;
  delivery_date: string | null;
  warehouse_id: string | null;
  payment_terms_days: number;
  discount_pct: number;
  reference: string | null;
  notes: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  status: SalesOrderStatus;
  credit_checked: boolean;
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  lines?: SalesOrderLine[];
}

export interface CreateSalesOrderDto {
  company_id: string;
  branch_id?: string;
  customer_id: string;
  order_date: string;
  delivery_date?: string;
  warehouse_id?: string;
  payment_terms_days?: number;
  discount_pct?: number;
  reference?: string;
  notes?: string;
  lines: Array<{
    item_id: string;
    description?: string;
    quantity: number;
    unit_price: number;
    discount_pct?: number;
    vat_rate?: number;
  }>;
}

// ================================================================
// DELIVERY RECEIPTS
// ================================================================
export type DeliveryReceiptStatus = 'draft' | 'posted' | 'cancelled';

export interface DeliveryReceiptLine {
  id: string;
  dr_id: string;
  so_line_id: string | null;
  line_no: number;
  item_id: string;
  item_sku?: string;
  item_name?: string;
  description: string;
  qty_delivered: number;
  unit_cost: number;
}

export interface DeliveryReceipt {
  id: string;
  company_id: string;
  branch_id: string | null;
  dr_no: string;
  so_id: string;
  order_no?: string;
  customer_id: string;
  customer_name?: string;
  warehouse_id: string;
  warehouse_name?: string;
  delivery_date: string;
  notes: string | null;
  status: DeliveryReceiptStatus;
  posted_at: string | null;
  posted_by: string | null;
  created_by: string;
  created_at: string;
  lines?: DeliveryReceiptLine[];
}

export interface CreateDeliveryReceiptDto {
  company_id: string;
  branch_id?: string;
  so_id: string;
  warehouse_id: string;
  delivery_date: string;
  notes?: string;
  lines: Array<{
    so_line_id?: string;
    item_id: string;
    description?: string;
    qty_delivered: number;
  }>;
}

// ================================================================
// SALES INVOICES
// ================================================================
export type SalesInvoiceStatus =
  | 'draft'
  | 'open'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export interface SalesInvoiceLine {
  id: string;
  invoice_id: string;
  line_no: number;
  item_id: string | null;
  item_sku?: string;
  item_name?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  revenue_account_id: string | null;
}

export interface SalesInvoice {
  id: string;
  company_id: string;
  branch_id: string | null;
  invoice_no: string;
  customer_id: string;
  customer_name?: string;
  so_id: string | null;
  order_no?: string | null;
  dr_id: string | null;
  dr_no?: string | null;
  invoice_date: string;
  due_date: string;
  payment_terms_days: number;
  reference: string | null;
  notes: string | null;
  currency: string;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total: number;
  amount_paid: number;
  balance: number;
  status: SalesInvoiceStatus;
  approved_by: string | null;
  approved_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  je_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  lines?: SalesInvoiceLine[];
}

export interface CreateSalesInvoiceDto {
  company_id: string;
  branch_id?: string;
  customer_id: string;
  so_id?: string;
  dr_id?: string;
  invoice_date: string;
  payment_terms_days?: number;
  reference?: string;
  notes?: string;
  lines: Array<{
    item_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    discount_pct?: number;
    vat_rate?: number;
    revenue_account_id?: string;
  }>;
}

// ================================================================
// AR CREDIT MEMOS
// ================================================================
export type ARCreditMemoStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'applied'
  | 'cancelled';

export interface ARCreditMemoLine {
  id: string;
  cm_id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
  revenue_account_id: string | null;
}

export interface ARCreditMemo {
  id: string;
  company_id: string;
  branch_id: string | null;
  cm_no: string;
  customer_id: string;
  customer_name?: string;
  original_invoice_id: string | null;
  invoice_no?: string | null;
  cm_date: string;
  reason: string | null;
  notes: string | null;
  subtotal: number;
  vat_amount: number;
  total: number;
  amount_applied: number;
  unapplied_amount: number;
  status: ARCreditMemoStatus;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  je_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  lines?: ARCreditMemoLine[];
}

export interface CreateARCreditMemoDto {
  company_id: string;
  branch_id?: string;
  customer_id: string;
  original_invoice_id?: string;
  cm_date: string;
  reason?: string;
  notes?: string;
  lines: Array<{
    item_id?: string;
    description: string;
    quantity: number;
    unit_price: number;
    vat_rate?: number;
    revenue_account_id?: string;
  }>;
}

export interface ApplyCreditMemoDto {
  applications: Array<{
    invoice_id: string;
    amount_applied: number;
  }>;
}

// ================================================================
// CUSTOMER PAYMENTS (COLLECTIONS)
// ================================================================
export type PaymentMethod = 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'online';
export type CustomerPaymentStatus = 'draft' | 'posted' | 'cleared' | 'cancelled';

export interface PaymentApplication {
  id: string;
  payment_id: string;
  invoice_id: string;
  invoice_no?: string;
  amount_applied: number;
}

export interface CustomerPayment {
  id: string;
  company_id: string;
  branch_id: string | null;
  receipt_no: string;
  customer_id: string;
  customer_name?: string;
  payment_date: string;
  payment_method: PaymentMethod;
  reference: string | null;
  bank_ref: string | null;
  check_date: string | null;
  amount: number;
  unapplied_amount: number;
  is_advance: boolean;
  bank_account_id: string | null;
  notes: string | null;
  status: CustomerPaymentStatus;
  posted_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  je_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  applications?: PaymentApplication[];
}

export interface CreateCustomerPaymentDto {
  company_id: string;
  branch_id?: string;
  customer_id: string;
  payment_date: string;
  payment_method: PaymentMethod;
  reference?: string;
  bank_ref?: string;
  check_date?: string;
  amount: number;
  bank_account_id?: string;
  notes?: string;
  is_advance?: boolean;
  applications?: Array<{
    invoice_id: string;
    amount_applied: number;
  }>;
}

// ================================================================
// AR REPORTS
// ================================================================
export interface AgingBucket {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  current: number;      // 0-30 days
  days_31_60: number;
  days_61_90: number;
  days_91_120: number;
  over_120: number;
  total: number;
}

export interface ARSummary {
  total_open_ar: number;
  total_overdue: number;
  total_collected_mtd: number;
  invoice_count_open: number;
  customer_count_active: number;
}

// ================================================================
// SHARED UTILITIES
// ================================================================
export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: AccountTypeCode;
  debit: number;
  credit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ================================================================
// ADMINISTRATION MODULE
// ================================================================

// --- Roles & Permissions ---
export interface Permission {
  id: string;
  module: string;
  action: string;
  description: string | null;
}

export interface Role {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  permissions?: Permission[];
}

export interface UserPermissionOverride {
  id: string;
  user_id: string;
  company_id: string | null;
  permission_id: string;
  is_granted: boolean;
  reason: string | null;
  created_at: string;
}

// --- Company (extended) ---
export interface Company {
  id: string;
  code: string;
  name: string;
  trade_name: string | null;
  tin: string | null;
  vat_status: 'VAT_REGISTERED' | 'NON_VAT' | 'EXEMPT' | null;
  rdo_code: string | null;
  business_style: string | null;
  registered_address: string | null;
  registration_date: string | null;
  books_start_date: string | null;
  accounting_method: 'ACCRUAL' | 'CASH';
  fiscal_year_start_month: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Branch (extended) ---
export interface Branch {
  id: string;
  company_id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  bir_atp_number: string | null;
  bir_atp_valid_from: string | null;
  bir_atp_valid_to: string | null;
  ptu_number: string | null;
  man_number: string | null;
  manager_user_id: string | null;
  is_active: boolean;
  created_at: string;
}

// --- Fiscal Years & Periods ---
export interface FiscalYear {
  id: string;
  company_id: string;
  year: number;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  periods?: FiscalPeriod[];
}

export interface FiscalPeriod {
  id: string;
  company_id: string;
  fiscal_year_id: string | null;
  period_name: string;
  start_date: string;
  end_date: string;
  status: 'OPEN' | 'CLOSED' | 'ADJUSTING';
  locked_at: string | null;
  locked_by: string | null;
}

// --- Cost Centers ---
export interface CostCenter {
  id: string;
  company_id: string;
  code: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Units of Measure ---
export interface Uom {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'TIME';
  is_base: boolean;
  created_at: string;
}

export interface UomConversion {
  id: string;
  company_id: string;
  from_uom_id: string;
  to_uom_id: string;
  factor: number;
}

// --- Payment Methods ---
export interface AdminPaymentMethod {
  id: string;
  company_id: string;
  code: string;
  name: string;
  account_id: string | null;
  requires_reference: boolean;
  is_active: boolean;
  created_at: string;
}

// --- Banks ---
export interface Bank {
  id: string;
  company_id: string;
  bank_name: string;
  account_number_last4: string | null;
  account_type: string | null;
  gl_account_id: string | null;
  is_active: boolean;
  created_at: string;
}

// --- Document Series ---
export interface DocumentSeries {
  id: string;
  company_id: string;
  branch_id: string | null;
  doc_type: string;
  prefix: string;
  last_no: number;
  updated_at: string;
}

// --- Approval Workflows ---
export interface ApprovalWorkflow {
  id: string;
  company_id: string;
  name: string;
  document_type: string;
  is_active: boolean;
  created_at: string;
  steps?: ApprovalWorkflowStep[];
}

export interface ApprovalWorkflowStep {
  id: string;
  workflow_id: string;
  step_no: number;
  approver_type: 'ROLE' | 'USER' | 'BRANCH_MANAGER';
  approver_ref: string | null;
  threshold_amount: number | null;
  sla_hours: number | null;
}

// --- BIR Setup ---
export interface BirSetup {
  id: string;
  branch_id: string;
  atp_number: string | null;
  atp_valid_from: string | null;
  atp_valid_to: string | null;
  ptu_number: string | null;
  man_number: string | null;
  signatory_name: string | null;
  signatory_tin: string | null;
  signatory_position: string | null;
  created_at: string;
  updated_at: string;
}

// --- Feature Flags ---
export interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  rollout_companies: string[];
  rollout_users: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

// --- Audit Log ---
export interface AuditLogEntry {
  id: string;
  company_id: string | null;
  user_id: string | null;
  user_email?: string;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// --- BIR Compliance ---

export interface TaxCode {
  id: string;
  company_id: string;
  code: string;
  name: string;
  tax_type: 'vat_output' | 'vat_input' | 'ewt' | 'excise' | 'percentage';
  rate_pct: number;
  account_id: string | null;
  bir_atc_code: string | null;
  is_active: boolean;
  created_at: string;
}

export interface IssuedDocument {
  id: string;
  company_id: string;
  branch_id: string | null;
  document_type: 'OR' | 'SI' | 'AR' | 'DR' | 'CI' | 'CR';
  series_id: string | null;
  document_no: string;
  transaction_date: string;
  customer_id: string | null;
  customer_tin: string | null;
  customer_name: string;
  customer_address: string | null;
  is_vat_registered: boolean;
  sc_pwd_id: string | null;
  total_amount: number;
  vatable_amount: number;
  vat_exempt_amount: number;
  zero_rated_amount: number;
  vat_amount: number;
  sc_discount: number;
  pwd_discount: number;
  total_discount: number;
  net_amount: number;
  status: 'active' | 'void' | 'cancelled';
  void_reason: string | null;
  voided_at: string | null;
  created_by: string;
  created_at: string;
  lines?: IssuedDocumentLine[];
}

export interface IssuedDocumentLine {
  id: string;
  document_id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  vatable_amount: number;
  vat_exempt_amount: number;
  zero_rated_amount: number;
  vat_amount: number;
  line_total: number;
  item_id: string | null;
  tax_code_id: string | null;
}

export interface ScPwdTransaction {
  id: string;
  company_id: string;
  branch_id: string | null;
  document_id: string;
  sc_pwd_type: 'SC' | 'PWD';
  id_number: string;
  beneficiary_name: string;
  osca_number: string | null;
  gross_amount: number;
  discount_rate: number;
  discount_amount: number;
  vat_exemption_amount: number;
  net_amount: number;
  transaction_date: string;
  created_at: string;
}

export interface BookGeneration {
  id: string;
  company_id: string;
  branch_id: string | null;
  book_type: 'SB' | 'PB' | 'GJ' | 'CVB' | 'CRB' | 'CDB';
  period_year: number;
  period_month: number | null;
  period_quarter: number | null;
  row_count: number;
  total_amount: number;
  status: 'draft' | 'final';
  storage_path: string | null;
  generated_by: string;
  generated_at: string;
  finalized_at: string | null;
}

export interface BirFiling {
  id: string;
  company_id: string;
  form_code: string;
  form_name: string;
  period_type: 'monthly' | 'quarterly' | 'annual';
  period_year: number;
  period_month: number | null;
  period_quarter: number | null;
  due_date: string;
  filed_date: string | null;
  status: 'draft' | 'ready' | 'filed' | 'amended';
  total_due: number;
  total_paid: number;
  reference_no: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  validations?: FilingValidation[];
}

export interface FilingValidation {
  id: string;
  filing_id: string;
  validation_type: 'error' | 'warning' | 'info';
  field_name: string | null;
  message: string;
  created_at: string;
}

export interface WhtCertificate {
  id: string;
  company_id: string;
  cert_no: string;
  bill_id: string;
  supplier_id: string;
  supplier_name?: string;
  bir_atc_code: string;
  taxable_amount: number;
  rate_pct: number;
  amount_withheld: number;
  period_year: number;
  period_quarter: number;
  status: 'draft' | 'issued' | 'filed';
  issued_at: string | null;
  filed_at: string | null;
  created_at: string;
}

export interface ExciseRate {
  id: string;
  company_id: string;
  product_type: string;
  description: string;
  rate_per_unit: number;
  unit_of_measure: string;
  effective_date: string;
  end_date: string | null;
  bir_classification: string | null;
  created_at: string;
}

export interface VatReturn2550Q {
  period_year: number;
  period_quarter: number;
  start_date: string;
  end_date: string;
  sales: {
    vatable: number;
    zero_rated: number;
    exempt: number;
    vat_output: number;
    gross_sales: number;
    doc_count: number;
  };
  purchases: {
    vatable: number;
    zero_rated: number;
    exempt: number;
    vat_input: number;
    doc_count: number;
  };
  output_vat: number;
  input_vat: number;
  vat_payable: number;
  excess_input: number;
}
