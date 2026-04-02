#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/tests/foundation/p0_contracts_test.sh"
"$ROOT/tests/foundation/p0_migrations_test.sh"
"$ROOT/tests/foundation/p0_startup_skeleton_test.sh"
"$ROOT/tests/foundation/p0_tauri_host_test.sh"
"$ROOT/tests/foundation/p0_docker_init_test.sh"
"$ROOT/scripts/ci/search_permission_prefilter_test.sh"

echo "foundation verification passed"
