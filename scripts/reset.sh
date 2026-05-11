#!/usr/bin/env bash
# DANGER: drop and recreate the database, then run migrations and seeds
set -euo pipefail

DB="${DB:-perpet_erp}"
USER="${PGUSER:-postgres}"

read -p "This will DESTROY all data in '$DB'. Continue? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

dropdb -U "$USER" --if-exists "$DB"
createdb -U "$USER" "$DB"

bash "$(dirname "$0")/migrate.sh"
bash "$(dirname "$0")/seed.sh"

echo "Database reset complete."
