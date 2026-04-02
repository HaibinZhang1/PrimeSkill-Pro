#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not running"
  exit 1
fi

cleanup() {
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" up -d postgres redis

echo "waiting for postgres..."
for i in {1..30}; do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U primeskill -d primeskill >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "running backend integration tests..."
cd "$ROOT"
pnpm --filter @prime/backend test:integration
