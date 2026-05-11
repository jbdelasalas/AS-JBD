# Inventory module (stub)

Items, warehouses, stock movements. Tables: items, item_categories, warehouses, stock_balances, stock_movements. Build adjustments, transfers, and the FIFO/Average costing engine.

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
