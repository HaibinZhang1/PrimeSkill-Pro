#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OPENAPI="$ROOT/packages/contracts-openapi/openapi.yaml"
IPC_CMDS="$ROOT/packages/contracts-ipc/commands.schema.json"
IPC_EVENTS="$ROOT/packages/contracts-ipc/events.schema.json"
QUEUE="$ROOT/packages/contracts-events/queue-events.schema.json"

[[ -f "$OPENAPI" ]] || { echo "missing $OPENAPI"; exit 1; }
[[ -f "$IPC_CMDS" ]] || { echo "missing $IPC_CMDS"; exit 1; }
[[ -f "$IPC_EVENTS" ]] || { echo "missing $IPC_EVENTS"; exit 1; }
[[ -f "$QUEUE" ]] || { echo "missing $QUEUE"; exit 1; }

grep -q "/api/desktop/install-tickets:" "$OPENAPI"
grep -q "/api/native/install-tickets/{ticketId}/manifest:" "$OPENAPI"
grep -q "/api/native/install-tickets/{ticketId}/consume:" "$OPENAPI"
grep -q "/api/native/install-operations/{installRecordId}/report:" "$OPENAPI"
grep -q "/api/desktop/search/skills:" "$OPENAPI"
grep -q "/api/admin/ai-tool-templates:" "$OPENAPI"

grep -q '"scan_tools"' "$IPC_CMDS"
grep -q '"apply_install_ticket"' "$IPC_CMDS"
grep -q '"install.progress"' "$IPC_EVENTS"
grep -q '"install.finalized"' "$IPC_EVENTS"

grep -q '"Stage1IndexJob"' "$QUEUE"
grep -q '"Stage2IndexJob"' "$QUEUE"
grep -q '"SearchAssembleJob"' "$QUEUE"
grep -q '"ReconcileJob"' "$QUEUE"

echo "p0_contracts_test passed"
