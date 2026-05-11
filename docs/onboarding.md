# Solo developer onboarding

Welcome. This is your roadmap.

## Week 1 — Get it running

1. Install Node 20, PostgreSQL 15, and a Postgres client (TablePlus, DBeaver, or
   `psql`).
2. Clone the repo, `npm install` at the root.
3. `createdb perpet_erp`
4. Run migrations and seeds: `npm run db:migrate && npm run db:seed`
5. Copy `.env.example` to `.env` in `apps/api/` and `.env.local` in `apps/web/`.
6. Start the API: `npm run dev:api` — visit http://localhost:4000/api/docs
7. Start the web: `npm run dev:web` — visit http://localhost:3000
8. Log in with `admin@perpet.com.ph` / `Perpet2026!`.
9. Browse the chart of accounts. Create a journal entry. Post it. Run trial
   balance. Confirm it balances.

If any step fails, **stop and fix it before continuing**. A broken local setup
will frustrate you later.

## Week 2-4 — Understand what's there

Read these files in order:

1. `db/migrations/001_init.sql` to `007_bir.sql` — understand the schema. Open
   each table in your DB client and look at its columns.
2. `apps/api/src/modules/auth/auth.service.ts` — understand the login flow,
   token issuance, password hashing.
3. `apps/api/src/modules/common/audit-log.service.ts` — understand why
   `audit_log` is non-negotiable.
4. `apps/api/src/modules/gl/journal-entries.service.ts` — read this carefully,
   slowly. This is the heart of the system. Every accounting transaction will
   eventually flow through here.

Try to answer:
- Why is the journal entry creation wrapped in `ds.transaction(...)`?
- What happens if `nextDocumentNumber` is called but the insert fails?
- Why does the schema CHECK constraint allow only debit XOR credit per line,
  rather than an unsigned `amount` and a `dr_cr` flag?

## Month 2 — Build the AR module end-to-end

Pick AR (receivables). It will teach you 80% of what you need.

Implementation order:

1. **CustomersController + Service** — basic CRUD. Easy. Reuse the patterns from
   `accounts.service.ts`.
2. **CustomersPage** in the web app — list + create form.
3. **InvoicesService** with `create` and `post`. Re-use `JournalEntriesService`
   for the GL posting.
4. **InvoicesPage** — list + detail.
5. **NewInvoicePage** — line items form, similar pattern to journal entry form.
6. **PaymentsService** with apply-to-invoice logic.

Acceptance test for yourself: when you post an invoice for ₱112,000 (₱100k +
₱12k VAT) to SM Hypermarket, the trial balance should show:
- AR up by ₱112,000
- Sales up by ₱100,000
- Output VAT up by ₱12,000
- Trial balance still balanced.

If any of those fail, find and fix the bug before moving on.

## Month 3 — Build AP

Mirror of AR. The complexity addition is **EWT** (expanded withholding tax).
When paying a supplier, you withhold a percentage and remit it to BIR later.

Read `apps/api/src/modules/ap/README.md` for the EWT computation example.

## Month 4-5 — Inventory

This is where the system gets harder. You need:
- Item master with costing method (FIFO or moving average).
- Stock movements that update `stock_balances` atomically.
- Costing engine: when stock moves out (sale), what's the COGS?
  - Average: COGS = qty × current avg_cost.
  - FIFO: COGS = qty consumed from oldest receipt layers.

Implement Average first. FIFO is much harder; do it later.

## Month 6+ — Fuel module (the differentiator)

Read `apps/api/src/modules/fuel/README.md` carefully. This is where Perpet
gets value that BC won't give you out of the box.

Start with tank readings (a glorified form), then deliveries (which post to AP +
inventory), then the daily reconciliation (which is mostly a query plus a JE).

## Discipline rules

These are not negotiable:

1. **Every state change writes to audit_log.** No exceptions. If your service
   modifies a row without calling `auditLog.record()`, fix it before merging.

2. **Money never uses `float`.** Use `numeric(18, 4)` in DB, parse with
   `Number()` from string in JS, format with `Intl.NumberFormat`.

3. **Every controller endpoint has a permission guard.** No `@Get()` without
   `@RequirePermissions(...)`. Even read endpoints.

4. **Every transaction that posts to GL goes through `JournalEntriesService`.**
   Do not insert into `journal_entry_lines` from anywhere else. Centralise the
   posting logic so the period-locking, balance, and audit checks happen exactly
   once.

5. **Test with real data.** Build a script that posts 100 random invoices and
   payments, then verify the trial balance still balances. If it doesn't, you
   have a bug.

6. **Read the SQL.** When something behaves unexpectedly, query the tables
   directly. Don't trust the UI.

## When you get stuck

- Re-read the relevant `README.md` in the module folder.
- Read `docs/architecture.md` again.
- Find a similar pattern in the GL module and copy it.
- If still stuck, ask Claude — provide the file, the error, and what you
  expected to happen.

## When this stops being fun

That's normal. ERP work is repetitive and detail-heavy. Take a break, read about
what you've built, and come back. The day your trial balance balances on real
poultry-... excuse me, real fuel transactions, you'll feel why this matters.
