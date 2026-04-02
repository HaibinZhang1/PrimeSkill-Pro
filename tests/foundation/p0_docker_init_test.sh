#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

required_files=(
  "$ROOT/scripts/dev/up_local_stack.sh"
  "$ROOT/scripts/dev/down_local_stack.sh"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "missing required docker/init file: $path" >&2
    exit 1
  fi
done

ROOT_PACKAGE_JSON="$ROOT/package.json" node - <<'EOF'
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync(process.env.ROOT_PACKAGE_JSON, 'utf8'));
for (const script of ['dev:infra', 'dev:infra:down']) {
  if (!pkg.scripts || !pkg.scripts[script]) {
    throw new Error(`missing root script: ${script}`);
  }
}
EOF

if ! rg -q 'db-init:' "$ROOT/infra/docker/docker-compose.yml"; then
  echo "docker compose must define db-init service" >&2
  exit 1
fi

if ! rg -q 'healthcheck:' "$ROOT/infra/docker/docker-compose.yml"; then
  echo "postgres service must define healthcheck" >&2
  exit 1
fi

if ! rg -q 'service_completed_successfully' "$ROOT/infra/docker/docker-compose.yml"; then
  echo "backend/worker must wait for db-init completion" >&2
  exit 1
fi

if ! rg -q 'psql ' "$ROOT/scripts/apply_migrations_order.sh"; then
  echo "apply_migrations_order.sh must execute migrations via psql" >&2
  exit 1
fi

if ! rg -q 'schema_migration' "$ROOT/scripts/apply_migrations_order.sh"; then
  echo "apply_migrations_order.sh must track applied migrations" >&2
  exit 1
fi

echo "p0_docker_init_test passed"
