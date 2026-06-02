-- 019_bills_ewt_code.sql
-- Link EWT tax codes to bills; ensure bill_lines and suppliers have required columns

ALTER TABLE bills ADD COLUMN IF NOT EXISTS ewt_code_id uuid REFERENCES tax_codes(id);

ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS ewt_rate    numeric(5,2)  DEFAULT 0;
ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS ewt_amount  numeric(18,2) DEFAULT 0;
ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS ewt_code_id uuid REFERENCES tax_codes(id);

ALTER TABLE suppliers  ADD COLUMN IF NOT EXISTS bir_atc_code varchar(10);
