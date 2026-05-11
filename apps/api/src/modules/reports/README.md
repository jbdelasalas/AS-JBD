# Reports module (stub)

Financial reports beyond Trial Balance (which lives in gl/). Build Income Statement, Balance Sheet, Cash Flow Statement, AR aging, AP aging by aggregating posted JEs.

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
