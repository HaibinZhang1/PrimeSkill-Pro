#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"
TMP_DIR="$(mktemp -d)"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
}

wait_for_http() {
  local url="$1"
  local label="$2"

  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$label failed to become ready: $url" >&2
  return 1
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "$label returned unexpected status: expected $expected got $actual" >&2
    exit 1
  fi
}

assert_contains() {
  local file="$1"
  local expected="$2"
  local label="$3"

  if ! rg -Fq "$expected" "$file"; then
    echo "$label did not contain expected text: $expected" >&2
    echo "--- actual body ---" >&2
    cat "$file" >&2
    exit 1
  fi
}

encode_token() {
  local payload="$1"
  node -e "console.log(Buffer.from(process.argv[1]).toString('base64url'))" "$payload"
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth_token="${4:-}"
  local device_token="${5:-}"
  local response_file="$6"

  local headers=(-H 'content-type: application/json')
  if [[ -n "$auth_token" ]]; then
    headers+=(-H "authorization: Bearer $auth_token")
  fi
  if [[ -n "$device_token" ]]; then
    headers+=(-H "x-device-token: $device_token")
  fi

  if [[ -n "$body" ]]; then
    curl -sS -o "$response_file" -w "%{http_code}" -X "$method" "${headers[@]}" --data "$body" "$url"
  else
    curl -sS -o "$response_file" -w "%{http_code}" -X "$method" "${headers[@]}" "$url"
  fi
}

trap cleanup EXIT

cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not running" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
docker compose -f "$COMPOSE_FILE" up --build -d

wait_for_http "http://127.0.0.1:8080/health" "backend health via nginx"
wait_for_http "http://127.0.0.1:8080/" "admin-web"

curl -fsS "http://127.0.0.1:8080/" -o "$TMP_DIR/admin.html"
assert_contains "$TMP_DIR/admin.html" "PrimeSkill Admin" "admin-web"

curl -fsS "http://127.0.0.1:8080/health" -o "$TMP_DIR/health.json"
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (body.ok !== true || body.service !== 'backend') {
  throw new Error('unexpected health payload: ' + JSON.stringify(body));
}
" "$TMP_DIR/health.json"

ADMIN_TOKEN="$(encode_token '{"userId":1,"clientDeviceId":10,"departmentIds":[1],"roleCodes":["platform_admin"]}')"
USER_TOKEN="$(encode_token '{"userId":2,"clientDeviceId":10,"departmentIds":[1],"roleCodes":["normal_user"]}')"
DEVICE_TOKEN="device-token-001"

docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U primeskill -d primeskill <<'SQL'
INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
INSERT INTO "user" (id, username, display_name, email, department_id)
VALUES
  (1, 'admin', 'Admin', 'admin@example.com', 1),
  (2, 'alice', 'Alice', 'alice@example.com', 1);
INSERT INTO client_device (id, user_id, device_fingerprint, device_name, os_type)
VALUES (10, 2, 'device-token-001', 'Alice-PC', 'windows');
INSERT INTO tool_instance (id, user_id, client_device_id, tool_id, os_type, trust_status)
VALUES (20, 2, 10, (SELECT id FROM ai_tool_catalog WHERE tool_code = 'cursor'), 'windows', 'verified');
INSERT INTO workspace_registry (id, user_id, client_device_id, workspace_name, workspace_path, project_fingerprint)
VALUES (30, 2, 10, 'demo', 'D:/repo/demo', 'fp-demo');
INSERT INTO skill (id, skill_key, name, summary, owner_user_id, owner_department_id, status, visibility_type)
VALUES (100, 'api_contract', 'API Contract Assistant', 'Generate API contracts quickly', 2, 1, 'published', 'public');
INSERT INTO skill_version (id, skill_id, version, package_uri, manifest_json, checksum, created_by, review_status)
VALUES (101, 100, '1.0.0', 'https://example.test/skill.zip', '{}'::jsonb, 'sha256:test', 2, 'approved');
UPDATE skill SET current_version_id = 101 WHERE id = 100;
INSERT INTO skill_search_profile (
  skill_version_id,
  title_text,
  summary_text,
  keyword_document,
  supported_tools_json,
  metadata_json
)
VALUES (
  101,
  'API Contract Assistant',
  'Generate API contracts quickly',
  'contract api assistant',
  '["cursor"]'::jsonb,
  '{}'::jsonb
);
SQL

template_status="$(
  request_json \
    POST \
    "http://127.0.0.1:8080/api/admin/ai-tool-templates" \
    '{"toolId":1,"templateCode":"cursor_project_rule_v2","templateRevision":2,"osType":"windows","artifactType":"rule","scopeType":"project","templateName":"cursor project v2","targetPathTemplate":"${workspaceRoot}/.cursor/rules","filenameTemplate":"${skillKey}.mdc","packagingMode":"single_file","contentManagementMode":"replace","pathVariables":["workspaceRoot","skillKey"],"isDefault":false,"releaseStatus":"active","verificationStatus":"candidate"}' \
    "$ADMIN_TOKEN" \
    "" \
    "$TMP_DIR/template.json"
)"
assert_status "$template_status" "201" "template publish"
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (typeof body.templateId !== 'number') {
  throw new Error('template publish missing templateId: ' + JSON.stringify(body));
}
" "$TMP_DIR/template.json"

search_status="$(
  request_json \
    POST \
    "http://127.0.0.1:8080/api/desktop/search/skills" \
    '{"query":"contract","page":1,"pageSize":10,"toolContext":["cursor"]}' \
    "$USER_TOKEN" \
    "" \
    "$TMP_DIR/search.json"
)"
assert_status "$search_status" "200" "skill search"
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!Array.isArray(body.items) || body.items.length === 0) {
  throw new Error('search response missing items: ' + JSON.stringify(body));
}
if (!body.items.some((item) => item.skillId === 100)) {
  throw new Error('search response missing seeded skill: ' + JSON.stringify(body));
}
" "$TMP_DIR/search.json"

create_status="$(
  request_json \
    POST \
    "http://127.0.0.1:8080/api/desktop/install-tickets" \
    '{"skillId":100,"skillVersionId":101,"operationType":"install","targetScope":"project","toolInstanceId":20,"workspaceRegistryId":30,"idempotencyKey":"idem-install-flow-001"}' \
    "$USER_TOKEN" \
    "" \
    "$TMP_DIR/install-create.json"
)"
assert_status "$create_status" "200" "install ticket create"

ticket_id="$(node -e "const fs=require('fs'); const body=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if (!body.ticketId || !body.installRecordId) throw new Error(JSON.stringify(body)); process.stdout.write(body.ticketId);" "$TMP_DIR/install-create.json")"
install_record_id="$(node -e "const fs=require('fs'); const body=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(body.installRecordId));" "$TMP_DIR/install-create.json")"

manifest_status="$(
  request_json \
    GET \
    "http://127.0.0.1:8080/api/native/install-tickets/$ticket_id/manifest" \
    "" \
    "$USER_TOKEN" \
    "$DEVICE_TOKEN" \
    "$TMP_DIR/manifest.json"
)"
assert_status "$manifest_status" "200" "install manifest fetch"
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (body.ticketId !== process.argv[2]) {
  throw new Error('manifest ticket mismatch: ' + JSON.stringify(body));
}
" "$TMP_DIR/manifest.json" "$ticket_id"

for stage in ticket_issued downloading staging verifying committing; do
  consume_status="$(
    request_json \
      POST \
      "http://127.0.0.1:8080/api/native/install-tickets/$ticket_id/consume" \
      "{\"installRecordId\":$install_record_id,\"stage\":\"$stage\",\"result\":\"ok\",\"traceId\":\"trace-$stage\"}" \
      "$USER_TOKEN" \
      "$DEVICE_TOKEN" \
      "$TMP_DIR/consume-$stage.json"
  )"
  assert_status "$consume_status" "200" "install consume $stage"
done

report_status="$(
  request_json \
    POST \
    "http://127.0.0.1:8080/api/native/install-operations/$install_record_id/report" \
    '{"finalStatus":"success","traceId":"trace-final"}' \
    "$USER_TOKEN" \
    "$DEVICE_TOKEN" \
    "$TMP_DIR/report.json"
)"
assert_status "$report_status" "200" "install final report"
node -e "
const fs = require('fs');
const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (body.ok !== true) {
  throw new Error('unexpected final report response: ' + JSON.stringify(body));
}
" "$TMP_DIR/report.json"

binding_count="$(
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U primeskill -d primeskill -Atc \
    "SELECT COUNT(*) FROM local_install_binding WHERE install_record_id = $install_record_id AND state = 'active';"
)"
if [[ "$binding_count" != "1" ]]; then
  echo "expected one active local_install_binding, got $binding_count" >&2
  exit 1
fi

echo "docker_acceptance_test passed"
