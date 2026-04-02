#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

required_files=(
  "$ROOT/apps/admin-web/package.json"
  "$ROOT/apps/admin-web/tsconfig.json"
  "$ROOT/apps/admin-web/vite.config.ts"
  "$ROOT/apps/admin-web/index.html"
  "$ROOT/apps/desktop-ui/package.json"
  "$ROOT/apps/desktop-ui/tsconfig.json"
  "$ROOT/apps/desktop-ui/vite.config.ts"
  "$ROOT/apps/desktop-ui/index.html"
  "$ROOT/scripts/ci/startup_smoke_test.sh"
  "$ROOT/.env.example"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "missing required startup file: $path" >&2
    exit 1
  fi
done

ROOT_PACKAGE_JSON="$ROOT/package.json" node - <<'EOF'
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync(process.env.ROOT_PACKAGE_JSON, 'utf8'));
const expectedScripts = [
  'dev:backend',
  'dev:worker',
  'dev:admin',
  'dev:desktop',
  'dev:stack',
  'docker:up',
  'docker:down',
  'test:startup',
];

for (const name of expectedScripts) {
  if (!pkg.scripts || !pkg.scripts[name]) {
    throw new Error(`missing root script: ${name}`);
  }
}
EOF

ADMIN_PACKAGE_JSON="$ROOT/apps/admin-web/package.json" DESKTOP_PACKAGE_JSON="$ROOT/apps/desktop-ui/package.json" node - <<'EOF'
const fs = require('fs');

for (const file of [process.env.ADMIN_PACKAGE_JSON, process.env.DESKTOP_PACKAGE_JSON]) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const script of ['dev', 'build']) {
    if (!pkg.scripts || !pkg.scripts[script]) {
      throw new Error(`missing ${script} script in ${file}`);
    }
  }
}
EOF

echo "p0_startup_skeleton_test passed"
