# Users module (stub)

User management. Tables: users, user_roles, refresh_tokens. Build CRUD + role assignment + 2FA enrollment (TOTP via speakeasy library).

See `db/migrations/` for the relevant table schema. Reuse `AuditLogService` for every state change and `JournalEntriesService` for any GL postings — never insert into `journal_entry_lines` directly from a non-GL service.
