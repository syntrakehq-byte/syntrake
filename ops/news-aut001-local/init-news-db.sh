#!/bin/sh
set -eu

for migration in /migrations/20261111150000_news_core_postgres_n1.sql \
  /migrations/20261111170000_news_core_n2a_revisions.sql \
  /migrations/20261111180000_news_core_n2b_entity_links.sql \
  /migrations/20261112100000_news_core_n2c_editorial_relations.sql \
  /migrations/20261112120000_news_core_n3c_factual_persistence.sql \
  /migrations/20261112150000_news_core_n5_read_api.sql \
  /migrations/20261112170000_news_core_n3c_factual_writer_boundary.sql \
  /migrations/20261113100000_news_core_bl3_factual_backlog.sql \
  /migrations/20261113110000_news_core_bl3_backlog_fencing.sql \
  /migrations/20261113185504_news_core_n3c_materializer_acl.sql; do
  echo "AUT001_APPLY_MIGRATION=$(basename "$migration")"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$migration"
done

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
alter role news_service login password '$NEWS_SERVICE_PASSWORD';
alter role news_pipeline_verifier login password '$NEWS_VERIFIER_PASSWORD';
alter role news_factual_attestor login password '$NEWS_ATTESTOR_PASSWORD';
alter role news_factual_writer login password '$NEWS_WRITER_PASSWORD';
SQL

echo 'AUT001_DATABASE_READY=true'
