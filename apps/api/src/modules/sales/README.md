# Sales module (stub)

Quotes and sales orders (NOT invoicing — that is in the AR module). Tables: sales_orders, sales_order_lines. Build the quote-to-cash pipeline: quote -> sales order -> delivery receipt -> sales invoice.

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
