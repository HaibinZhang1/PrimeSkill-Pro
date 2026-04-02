#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
ADMIN_PID=""
DESKTOP_PID=""
BACKEND_PID=""

cleanup_process() {
  local pid="${1:-}"
  if [[ -z "$pid" ]]; then
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  pkill -P "$pid" 2>/dev/null || true
}

cleanup() {
  cleanup_process "$ADMIN_PID"
  cleanup_process "$DESKTOP_PID"
  cleanup_process "$BACKEND_PID"
  rm -rf "$TMP_DIR"
}

wait_for_http() {
  local url="$1"
  local label="$2"

  for _ in $(seq 1 30); do
    if curl -sf "$url" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "$label failed to become ready: $url" >&2
  return 1
}

trap cleanup EXIT

cd "$ROOT"

./tests/foundation/p0_startup_skeleton_test.sh
./scripts/ci/search_worker_queue_smoke_test.sh

pnpm --filter @prime/admin-web build
pnpm --filter @prime/desktop-ui build
pnpm dev:worker >/tmp/primeskill-worker-smoke.log

pnpm dev:admin >"$TMP_DIR/admin.log" 2>&1 &
ADMIN_PID=$!
wait_for_http "http://127.0.0.1:4173" "admin-web"

pnpm dev:desktop >"$TMP_DIR/desktop.log" 2>&1 &
DESKTOP_PID=$!
wait_for_http "http://127.0.0.1:4174" "desktop-ui"

pnpm dev:backend >"$TMP_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
wait_for_http "http://127.0.0.1:3000/health" "backend"

echo "startup_smoke_test passed"
