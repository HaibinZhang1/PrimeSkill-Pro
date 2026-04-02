#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not running" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" up -d postgres redis minio

echo "waiting for postgres..."
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U primeskill -d primeskill >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "applying migrations and seed..."
docker compose -f "$COMPOSE_FILE" run --rm db-init

echo "local infra is ready"
