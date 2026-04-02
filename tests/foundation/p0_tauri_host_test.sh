#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

required_files=(
  "$ROOT/apps/desktop-ui/src-tauri/Cargo.toml"
  "$ROOT/apps/desktop-ui/src-tauri/build.rs"
  "$ROOT/apps/desktop-ui/src-tauri/src/main.rs"
  "$ROOT/apps/desktop-ui/src-tauri/tauri.conf.json"
  "$ROOT/apps/desktop-ui/src-tauri/capabilities/default.json"
)

for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "missing required tauri host file: $path" >&2
    exit 1
  fi
done

DESKTOP_PACKAGE_JSON="$ROOT/apps/desktop-ui/package.json" node - <<'EOF'
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync(process.env.DESKTOP_PACKAGE_JSON, 'utf8'));

for (const script of ['tauri:dev', 'tauri:build']) {
  if (!pkg.scripts || !pkg.scripts[script]) {
    throw new Error(`missing desktop script: ${script}`);
  }
}
EOF

if ! rg -q 'apps/native-core' "$ROOT/apps/desktop-ui/src-tauri/Cargo.toml"; then
  echo "tauri host must depend on apps/native-core via path dependency" >&2
  exit 1
fi

if ! rg -q 'native_bootstrap_status' "$ROOT/apps/desktop-ui/src-tauri/src/main.rs"; then
  echo "tauri host must expose native_bootstrap_status command" >&2
  exit 1
fi

echo "p0_tauri_host_test passed"
