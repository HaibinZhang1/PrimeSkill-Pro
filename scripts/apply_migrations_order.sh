#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$ROOT/infra/db/migrations"
DATABASE_URL="${DATABASE_URL:-postgresql://primeskill:primeskill@127.0.0.1:5432/primeskill}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to apply migrations" >&2
  exit 1
fi

psql_exec() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X "$@"
}

psql_exec <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migration (
  name VARCHAR(128) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

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
  applied="$(psql "$DATABASE_URL" -Atqc "SELECT 1 FROM schema_migration WHERE name = '$f' LIMIT 1")"
  if [[ "$applied" == "1" ]]; then
    echo "-- skip $f (already applied)"
    continue
  fi

  echo "-- apply $f"
  psql_exec -f "$MIG_DIR/$f"
  psql_exec -c "INSERT INTO schema_migration (name) VALUES ('$f')"
done
