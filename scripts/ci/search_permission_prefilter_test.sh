#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="$ROOT/apps/backend/src/modules/search/permission-prefilter.ts"

[[ -f "$FILE" ]] || { echo "missing $FILE"; exit 1; }

grep -q "NOT EXISTS" "$FILE"
grep -q "effect = 'deny'" "$FILE"
grep -q "effect = 'allow'" "$FILE"
grep -q "s.status = 'published'" "$FILE"

echo "search_permission_prefilter_test passed"
