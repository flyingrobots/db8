#!/usr/bin/env bash

set -euo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.test.yml}
# Ensure stable, named resources even if compose doesn't read 'name:'
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-db8-test}

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes >/dev/null
}

# Register traps BEFORE starting any containers or readiness polling
trap cleanup EXIT ERR

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

# Detect TTY: disable TTY only when stdin is not a TTY.
# This keeps interactive runs attached while CI/hooks avoid the "not a TTY" error.
DOCKER_TTY=""
if [ ! -t 0 ]; then
  DOCKER_TTY="-T"
fi

# The suite runs twice against the same database on purpose.
#
# Pass 1 is the normal run. Pass 2 is the idempotency gate: it reuses the
# database pass 1 left behind, which is the only way to catch tests that depend
# on starting from empty. Three real bugs hid behind this exact blind spot —
# a schema contradiction that made audited participants undeletable, a fixture
# that asserted against the previous run's terminal state, and a quota test that
# passed vacuously because its round was already spent. All three were invisible
# to a harness that tore the volume down after a single pass.
#
# Signing keys are deliberately NOT pre-seeded. Doing so used to hide a race in
# getPersistentSigningKeys by ensuring it never had to generate a pair; the
# generation path is now correct and CI should exercise it for real.
docker compose -f "$COMPOSE_FILE" run $DOCKER_TTY --rm tests bash -lc '
  set -euo pipefail
  npm ci
  npm run test:prepare-db
  echo "── pass 1 of 2: fresh database ──"
  npm run test:inner
  echo "── pass 2 of 2: same database (idempotency gate) ──"
  npm run test:inner
'
