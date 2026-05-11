# Companies module (stub)

Multi-company / branch management. Tables: companies, branches, fiscal_periods. Build CRUD + period close logic. Closing a period sets status to closed; new entries with that date are then rejected.

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
