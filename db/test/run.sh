#!/usr/bin/env bash
# Run the pgTAP suite against $PGURL.
#
# psql exits 0 when an assertion fails, because a failing assertion is just a
# row of output. So this reads the TAP itself and fails the run on any "not ok"
# that is not marked TODO, on any plan mismatch ("# Looks like ..."), and on any
# SQL error (#238).
set -euo pipefail
PGURL=${PGURL:-postgresql://postgres:test@localhost:54329/postgres}

psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgtap'

status=0
for f in db/test/*.sql db/test/*.pgtap; do
  echo "→ $f"
  if ! out=$(psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    printf '%s\n' "$out"
    echo "✗ $f: SQL error"
    status=1
    continue
  fi
  printf '%s\n' "$out"
  if grep -E '^not ok' <<<"$out" | grep -vq '# TODO'; then
    echo "✗ $f: failing assertion"
    status=1
  fi
  if grep -q '^# Looks like' <<<"$out"; then
    echo "✗ $f: plan mismatch or failures"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then echo "pgTAP: all files passed"; fi
exit "$status"
