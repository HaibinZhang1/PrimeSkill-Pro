#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/infra/db/migrations"

for f in \
  M001_extensions.sql \
  M002_iam_org.sql \
  M003_skill_review.sql \
  M004_tool_template.sql \
  M005_device_workspace.sql \
  M006_install_governance.sql \
  M007_search_indexes.sql \
  M008_audit_seed.sql \
  M009_constraints_finalize.sql; do
  [[ -f "$MIG/$f" ]] || { echo "missing migration: $f"; exit 1; }
done

grep -Eq "CREATE TABLE( IF NOT EXISTS)? install_ticket" "$MIG/M006_install_governance.sql"
grep -q "consume_mode" "$MIG/M006_install_governance.sql"
grep -q "retry_token" "$MIG/M006_install_governance.sql"
grep -q "status_version" "$MIG/M006_install_governance.sql"
grep -q "operation_seq" "$MIG/M006_install_governance.sql"
grep -Eq "CREATE TABLE( IF NOT EXISTS)? skill_search_profile" "$MIG/M007_search_indexes.sql"
grep -Eq "CREATE TABLE( IF NOT EXISTS)? skill_document" "$MIG/M007_search_indexes.sql"
grep -q "vector_cosine_ops" "$MIG/M007_search_indexes.sql"
grep -q "WHERE state='active'" "$MIG/M009_constraints_finalize.sql"
grep -q "WHERE idempotency_key IS NOT NULL" "$MIG/M009_constraints_finalize.sql"

echo "p0_migrations_test passed"
