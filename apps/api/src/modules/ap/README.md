# AP module (stub)

Accounts Payable: suppliers, vendor bills, supplier payments.

## Tables already in DB

- `suppliers`, `bills`, `bill_lines`, `supplier_payments`, `bill_payment_applications`
- `wht_certificates` (for BIR Form 2307)

## What to implement next

1. **SuppliersService + SuppliersController** — CRUD with company scoping. Each
   supplier carries an `ewt_rate` which determines withholding when paying.

2. **BillsService**:
   - On entry, compute input VAT per line.
   - On approval/post, generate JE: `Dr Expense/Inventory / Dr Input VAT / Cr AP`.
   - Insert into `vat_relief_entries` (entry_type = 'purchases') for SLSP.

3. **SupplierPaymentsService**:
   - On payment, withhold EWT based on supplier's `ewt_rate` against the taxable
     base (the subtotal, NOT the VAT amount).
   - Generate JE: `Dr AP (gross) / Cr EWT payable / Cr Cash`.
   - Create a `wht_certificates` row so we can issue Form 2307 to the supplier.

4. **Three-way match** (when PO module is built):
   Validate qty and price agreement between PO, GRN, and Bill before approving.

## EWT computation example

Supplier rate: 1% (goods), bill subtotal ₱100,000, VAT ₱12,000, total ₱112,000.
- EWT = subtotal × 1% = ₱1,000
- Net pay to supplier = ₱112,000 − ₱1,000 = ₱111,000
- Liability to BIR (EWT payable) = ₱1,000
