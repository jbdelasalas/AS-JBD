# BIR module (stub) — Philippines compliance

## Tables already in DB

- `tax_codes` — VAT, EWT, percentage tax definitions
- `wht_certificates` — Form 2307 source data
- `vat_relief_entries` — sales/purchases relief detail (SLSP / 2550Q attachments)
- `bir_filings` — record of filed forms
- `document_series` — controlled invoice/OR/DR numbering

## What to implement next

### 1. Form 2550M (Monthly VAT)
Aggregate:
- **Total sales** (vatable + zero-rated + exempt) from `vat_relief_entries` where
  type='sales' for the period.
- **Output VAT** = sum of vat_amount on sales.
- **Total purchases** + **Input VAT** from type='purchases'.
- **Net VAT due** = Output VAT − Input VAT (carried over from previous month if any).

Endpoint: `GET /bir/forms/2550M?company_id=X&year=2026&month=5`
Returns the data in BIR's prescribed layout, ready for manual filing or eFPS upload.

### 2. Form 1601-EQ (Quarterly EWT)
Aggregate `wht_certificates` by `bir_atc_code` for the quarter. Group by ATC and
sum `taxable_amount` and `amount_withheld`.

### 3. Form 2307 (Certificate of CWT)
For each posted bill where EWT was withheld, generate a printable certificate
showing the supplier, taxable base, ATC, rate, and amount withheld. Suppliers
need this to claim CWT credits.

### 4. Document series management
- View current_number and remaining for each series.
- Validate before issuing — never reuse a number, never skip (the Bureau will
  audit gaps).
- Record `bir_permit_no` and `bir_permit_date` (CAS PTU accreditation).

## CAS PTU implications

To use this system as a Computerized Accounting System with the BIR, you need a
**Permit to Use (PTU-CAS)**. Requirements include:

- Sequential, gap-free document numbering (we enforce this in `nextDocumentNumber`).
- Immutable audit trail of all transactions (we have `audit_log`).
- Tamper-evident posting controls (posted entries must not be edited; only voided
  with reason — already enforced in `JournalEntriesService`).
- BIR-prescribed sales invoice / OR layout including TIN, RDO, permit no., and
  serial number.
- System validation report and User's Manual submitted with the PTU application.

This stub is **not** PTU-accredited. Treat the system as for internal/learning
use until accreditation is obtained.
