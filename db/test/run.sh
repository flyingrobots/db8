#!/usr/bin/env bash
set -euo pipefail
PGURL=${PGURL:-postgresql://postgres:test@localhost:54329/postgres}
for f in db/test/*.sql db/test/*.pgtap; do
  echo "→ $f"; psql "$PGURL" -v ON_ERROR_STOP=1 -f "$f"
done

