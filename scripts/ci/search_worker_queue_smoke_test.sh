#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT"

pnpm --filter @prime/search-worker exec tsx --test test/boot.test.ts

echo "search_worker_queue_smoke_test passed"
