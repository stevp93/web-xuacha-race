#!/usr/bin/env bash
# Base limpia para las pruebas: migraciones + datos del evento + inscripciones abiertas.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/env.sh"
SUPA="$HERE/../../supabase"
psql -q "$E2E_PG/postgres" -c "drop database if exists xr_e2e with (force)" -c "create database xr_e2e"
for f in "$SUPA"/migrations/*.sql "$SUPA"/seed.sql; do psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f"; done
psql -q "$DATABASE_URL" -c "update events set registration_open = true"
