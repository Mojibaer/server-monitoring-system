#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "ALTER ROLE supabase_admin WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}';"
