#!/bin/bash
set -euo pipefail
# Mismo servidor Postgres; bases aparte para no mezclar Event History con RAG.
for db in temporal temporal_visibility; do
  exists="$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'")"
  if [ "$exists" != "1" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -c "CREATE DATABASE ${db}"
  fi
done
