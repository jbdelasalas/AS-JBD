-- Add phone contact field to branches table
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS phone varchar(50);
