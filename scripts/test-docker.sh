#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.test.yml}

docker compose -f "$COMPOSE_FILE" up -d db >/dev/null

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
