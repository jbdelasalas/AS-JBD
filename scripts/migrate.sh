#!/usr/bin/env bash
# Run all migrations in order
set -euo pipefail

DB="${DB:-perpet_erp}"
USER="${PGUSER:-postgres}"

echo "Running migrations against database: $DB"

for f in db/migrations/*.sql; do
  echo "  -> applying $f"
  psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$f"
done

echo "Migrations complete."
