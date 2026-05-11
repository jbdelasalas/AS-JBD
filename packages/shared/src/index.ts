// Shared types used by both backend and frontend

export type AccountTypeCode = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type JournalEntryStatus = 'draft' | 'pending' | 'posted' | 'voided';

export type DocStatus = 'draft' | 'pending' | 'approved' | 'posted' | 'partial' | 'paid' | 'voided' | 'cancelled';

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
  account_code?: string;       // populated on read for convenience
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
  entry_date: string;          // ISO date
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
