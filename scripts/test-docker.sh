#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.test.yml}
# Ensure stable, named resources even if compose doesn't read 'name:'
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-db8-test}

docker compose -f "$COMPOSE_FILE" up -d db >/dev/null

# Wait for Postgres to be ready before running tests
echo "Waiting for Postgres to accept connections..."
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T db pg_isready -U postgres -d db8_test >/dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "Postgres did not become ready in time." >&2
    exit 1
  fi
done

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null
}

trap cleanup EXIT

# Detect TTY: disable TTY only when stdin is not a TTY.
# This keeps interactive runs attached while CI/hooks avoid the "not a TTY" error.
DOCKER_TTY=""
if [ ! -t 0 ]; then
  DOCKER_TTY="-T"
fi

docker compose -f "$COMPOSE_FILE" run $DOCKER_TTY --rm tests bash -lc 'npm ci && npm run test:prepare-db && npm run test:inner'
