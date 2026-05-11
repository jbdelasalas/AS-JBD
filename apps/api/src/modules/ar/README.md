# AR module (stub)

Accounts Receivable: customers, sales invoices, customer payments / official receipts.

## Tables already in DB

- `customers`, `sales_invoices`, `sales_invoice_lines`
- `customer_payments`, `payment_applications`

## What to implement next

1. **CustomersService + CustomersController** — CRUD with company scoping.
2. **InvoicesService**:
   - Issue invoice number from `document_series` where `doc_type = 'sales_invoice'`.
   - Compute VAT per line (12% standard, 0% if customer is VAT-exempt or zero-rated).
   - On post, generate a journal entry: `Dr AR / Cr Sales / Cr Output VAT`.
   - Insert a row in `vat_relief_entries` for the BIR sales relief feed.
3. **PaymentsService**:
   - Issue OR number.
   - On post, generate JE: `Dr Cash/Bank / Cr AR`.
   - Apply payment to invoices via `payment_applications`. Update each invoice's
     `amount_paid`, `balance`, and `status`.

Reuse `JournalEntriesService` from `gl/` — do NOT duplicate posting logic.

The journal entry created from a sales invoice should set:
- `source_module = 'ar'`
- `source_doc_type = 'sales_invoice'`
- `source_doc_id = invoice.id`

This makes drill-down from a JE back to the source document trivial.
