#!/usr/bin/env bash
# Seed demo data
set -euo pipefail

DB="${DB:-perpet_erp}"
USER="${PGUSER:-postgres}"

echo "Seeding database: $DB"

for f in db/seeds/*.sql; do
  echo "  -> applying $f"
  psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 -f "$f"
done

echo "Seeding complete. Default login: admin@perpet.com.ph / Perpet2026!"
