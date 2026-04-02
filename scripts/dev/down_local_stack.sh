#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not running" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down -v

echo "local infra stopped"
