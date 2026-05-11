# Architecture overview

## High-level

```
┌─────────────────┐       HTTPS/JSON      ┌──────────────────┐
│  Next.js (web)  │ ────────────────────> │  NestJS (api)    │
│   App Router    │ <──────────────────── │   REST + JWT     │
└─────────────────┘                       └────────┬─────────┘
                                                   │ TypeORM raw queries
                                                   ▼
                                          ┌──────────────────┐
                                          │   PostgreSQL     │
                                          │  + audit_log     │
                                          └──────────────────┘
```

## Why these choices

- **NestJS**: opinionated structure, decorators-based DI, batteries included for
  validation/Swagger. Great for someone learning — the framework forces good
  habits.
- **Next.js App Router**: React's current best practice for new projects. Server
  components by default but we use `'use client'` for interactive screens.
- **PostgreSQL**: every serious accounting system runs on a real RDBMS.
  Constraints, transactions, and `numeric` precision matter.
- **TypeORM with raw SQL**: we deliberately avoid ORM-managed migrations and use
  hand-written `.sql` files. Reasons:
  1. You can review every DDL change in a code review.
  2. PostgreSQL features (generated columns, partial indexes, JSONB) are easier.
  3. You learn SQL properly, which is non-negotiable for accounting work.
  TypeORM is used for connection pooling and `tx.query()` only.

## Folder conventions

```
apps/api/src/
  main.ts              ← bootstrap, validation pipe, Swagger
  app.module.ts        ← imports all feature modules
  common/              ← global filters, decorators, guards
  modules/<name>/
    *.module.ts        ← Nest module wiring
    *.controller.ts    ← HTTP shape: routes, DTOs, guards
    *.service.ts       ← business logic, talks to DB
    README.md          ← what's done and what's next
```

**Rule**: controllers never touch the database. Only services do.
**Rule**: services never throw raw `Error`. Use Nest's `BadRequestException`,
`NotFoundException`, `ConflictException`, etc. — they map to correct HTTP codes.

## The audit trail is sacred

Every state-changing action — login, create, update, delete, post, void, approve
— must call `AuditLogService.record()` with `userId`, `entityType`, `entityId`,
and the `before`/`after` state. This is non-negotiable for BIR CAS PTU compliance
and basic forensic accountability.

The schema deliberately has no `DELETE` semantics for transactional data
(invoices, bills, journal entries). Use `void` with a reason instead.

## Money is `numeric(18, 4)`

Never `float`, never `double`. Floats can't represent 0.10 exactly. Postgres
`numeric` is arbitrary precision and is what every serious accounting system
uses.

In TypeScript code, money values come back from pg as strings. Always wrap with
`Number()` or use a `Decimal` library for arithmetic, then format with
`Intl.NumberFormat` for display.

## Document numbering

`document_series` is incremented atomically inside the same transaction that
creates the document. This guarantees:
- No gaps (BIR audit requirement).
- No duplicates (uniqueness enforced at DB level via the `UNIQUE (company_id,
  entry_no)` constraints on each document table).

If a transaction fails after a number is issued, the SERIES update rolls back —
because both happen in the same `BEGIN`/`COMMIT` block. This is why
`JournalEntriesService.create` wraps everything in `ds.transaction(...)`.

## RBAC

- `permissions` table: granular `module.action` codes.
- `roles` table: groupings.
- `role_permissions`: many-to-many.
- `user_roles`: user gets one or more roles, optionally scoped to a company /
  branch.
- The `PermissionsGuard` checks the JWT's `permissions` claim against
  `@RequirePermissions(...)` on the controller method.
- Superadmins bypass the check.

When you add a new feature, add the permission code to migration 002, then guard
the endpoint with `@RequirePermissions('your.code')`.

## How a sales invoice will work (when you build AR)

1. POST `/ar/invoices` with customer + lines.
2. AR service:
   - Issue next invoice number from `document_series` (doc_type='sales_invoice').
   - Compute VAT per line.
   - Insert `sales_invoices` + `sales_invoice_lines`.
   - Status = 'draft'.
3. POST `/ar/invoices/:id/post`:
   - Validate fiscal period is open.
   - Call `JournalEntriesService.create` with:
     - Dr Accounts Receivable (gross)
     - Cr Sales (net of VAT)
     - Cr Output VAT
     - source_module='ar', source_doc_type='sales_invoice', source_doc_id=invoice.id
   - Call `JournalEntriesService.post` immediately after.
   - Update `sales_invoices.je_id` and `status='posted'`.
   - Insert into `vat_relief_entries` for BIR sales relief.
   - All in one transaction.
4. Audit log: 'create' on the invoice, 'post' separately.

This pattern repeats for every transactional document. Centralise GL posting in
the GL service, do not duplicate.
