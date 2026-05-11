# Purchasing module (stub)

Purchase requisitions and POs. Tables: purchase_orders, purchase_order_lines, goods_receipts, goods_receipt_lines. Build the PR -> PO -> GRN flow with multi-level approval thresholds.

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
