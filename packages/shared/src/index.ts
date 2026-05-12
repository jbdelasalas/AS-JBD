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
