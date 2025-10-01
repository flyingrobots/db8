#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.test.yml}

docker compose -f "$COMPOSE_FILE" up -d db >/dev/null

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null
}

trap cleanup EXIT

docker compose -f "$COMPOSE_FILE" run --rm tests bash -lc 'npm ci && npm run test:prepare-db && npm run test:inner'
