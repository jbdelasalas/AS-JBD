-- Add contact and branding fields to companies table
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS phone   varchar(50),
  ADD COLUMN IF NOT EXISTS email   varchar(200),
  ADD COLUMN IF NOT EXISTS website varchar(200),
  ADD COLUMN IF NOT EXISTS logo    text;
