---
lastUpdated: 2025-10-05
---

# Local Database Setup (Postgres / Supabase)

This guide shows how to run the local Postgres, apply schema and RPCs, run
optional pgTAP invariants, and exercise the app end-to-end.

## Start Postgres

- Using the repo’s docker compose:

`````text
docker compose -f docker-compose.test.yml up -d db
# DB URL: postgresql://postgres:test@localhost:54329/db8_test
```text

If you’re using Supabase locally, use the connection string for your local
project and substitute it wherever this guide uses the DB URL.

## Apply Schema and RPCs

Load the M1 schema and SQL RPCs into your database:

```text
psql postgresql://postgres:test@localhost:54329/db8_test -f db/schema.sql
psql postgresql://postgres:test@localhost:54329/db8_test -f db/rpc.sql
```

### RLS and Secure Views

Row-Level Security (RLS) is enabled for core tables, and the server reads via
secure views only. Views are marked as `security_barrier` to prevent predicate
push-down across RLS boundaries.

- Files
  - `db/rls.sql`: enables RLS and defines policies.
  - `db/rpc.sql`: defines read-only views and sets `security_barrier=true`.
  - `db/rpc.sql`: also provides a privileged
    `admin_audit_log_write(...)` RPC for inserting into the locked-down audit
    log (intended for service/worker use).

The prep script applies schema, RPCs, and RLS:

```text
npm run test:prepare-db
```

### Create a Room + Seed Participants

The new `room_create(topic text, cfg jsonb DEFAULT '{}'::jsonb, nonce text)` RPC
seeds a room, round 0, and a roster of anonymous participants. Defaults:
`participant_count=4`, `submit_minutes=5`; pass a `nonce` to make the call
idempotent.

Examples:

```text
# simplest call
psql postgresql://postgres:test@localhost:54329/db8_test \
  -c "select room_create('Demo Topic');"

# override participant count and submit window, plus a client nonce for idempotency
psql postgresql://postgres:test@localhost:54329/db8_test <<'SQL'
select room_create(
  'Demo Topic',
  '{"participant_count":4,"submit_minutes":2}'::jsonb,
  'demo-room-nonce'
);
SQL
```text

The function returns the `room_id` you can plug into API calls or the CLI.
Repeating the call with the same nonce reuses the existing room.

## Optional: Run pgTAP Invariants

We include pgTAP files that assert the DB invariants (tables, uniques, RPC
existence, idempotency). These are optional and default to off in CI.

1. Ensure the `pgtap` extension is installed in your DB:

```text
# Inside the container or your Postgres host; adjust version as needed
# Example with Debian-based Postgres 16 image:
# docker exec -it <container> bash -lc "apt-get update && apt-get install -y
postgresql-16-pgtap"

psql postgresql://postgres:test@localhost:54329/db8_test \
  -c 'CREATE EXTENSION IF NOT EXISTS pgtap;'
```text

1. Run all pgTAP files:

```text
PGURL=postgresql://postgres:test@localhost:54329/db8_test ./db/test/run.sh
```text

## Run Node Tests with DB Backed Path

`npm test` launches Vitest through Docker compose so the suite always sees a
Postgres sidecar:

```text
npm test
```text

The command brings up the `db` container (if needed), applies `db/schema.sql`
and `db/rpc.sql`, executes tests from the `tests` service against
`postgresql://postgres:test@db:5432/db8_test`, and then tears the stack down
automatically when the run finishes.

Need to bypass Docker for debugging? Set `CI=true` or call the inner script
directly:

```text
CI=true npm test
npm run test:inner
```text

## Run the Server with DB

Config is read via a safe builder (no direct `process.env` in the app). Set
these variables as needed and start the server:

```text
export DATABASE_URL=postgresql://postgres:test@localhost:54329/db8_test
export PORT=3000
# Optional knobs
# export SUBMIT_WINDOW_SEC=300
# export CONTINUE_WINDOW_SEC=30
# export ENFORCE_RATELIMIT=0

node server/rpc.js
# healthcheck
curl <http://localhost:3000/health>
```text

### Environment Flags (M2)

These flags gate new M2 capabilities and are read by the server and CLI.

- `CANON_MODE=sorted|jcs`
  - `jcs` (default): RFC 8785 JSON Canonicalization Scheme (recommended for provenance).
  - `sorted`: legacy sorted-keys canonicalization (temporary compatibility mode).
- `ENFORCE_SERVER_NONCES=1`
  - When set, the API enforces single-use server-issued nonces for submissions.
  - Issue a nonce via `POST /rpc/nonce.issue` and include it as `client_nonce` in
    `POST /rpc/submission.create`.
  - Behavior is atomic on the DB path and safely falls back to memory when the
    DB rejects nonces due to missing rows in dev.
- `SIGNING_PRIVATE_KEY` / `SIGNING_PUBLIC_KEY`
  - PEM-encoded Ed25519 keypair used to sign journals.
  - If unset, the server generates an in-memory dev keypair at startup (for dev
    only) and logs a warning.

### Journals + CLI Verify

The server publishes per-round journals that include a chain hash and an Ed25519
signature. You can fetch and verify them via HTTP or the CLI.

- Endpoints
  - `GET /journal?room_id=<uuid>` — latest journal (synthesized if DB is absent)
  - `GET /journal?room_id=<uuid>&idx=<n>` — journal by round index
    - DB: returns the stored row `{ room_id, round_idx, hash, signature, core, created_at }`.
    - Memory: returns the synthesized latest only when `idx` equals the latest
      round; otherwise `404`.
  - `GET /journal/history?room_id=<uuid>` — ordered list of stored journals.

### Provenance verification and author binding (M2)

`POST /rpc/provenance.verify` canonicalizes the provided document using the server’s `CANON_MODE` and verifies Ed25519 signatures.

- On success, returns `{ ok: true, hash, public_key_fingerprint }` where the fingerprint is `sha256:<hex>` of the DER‑encoded public key. If a participant fingerprint is configured (see below), response also includes `author_binding: "match"`.
- Strict author binding: if the participant row has `ssh_fingerprint` populated, the fingerprint used to verify MUST match. On mismatch the server returns `400 { ok:false, error:"author_binding_mismatch", expected_fingerprint, got_fingerprint }`.
- Store the expected fingerprint in `participants.ssh_fingerprint`. Preferred format: `sha256:<hex>`; if plain hex is provided, the server normalizes to `sha256:<hex>` for comparison.

- CLI
  - `db8 journal:verify --room <uuid>` — verifies the latest journal signature
  - `db8 journal:verify --room <uuid> --history` — verifies every stored
    journal and checks chain linking via `prev_hash`.

## Test-only SQL helpers (do not deploy)

- File: `db/test/helpers.sql`
- Purpose: utilities to make tests deterministic (e.g., set a round’s
  `submit_deadline_unix`).
- Safety: functions refuse to run unless the database name clearly indicates a
  test database.
  - Allowed patterns: names ending with `_test`, or starting with `test_`.
  - The helpers run with `SECURITY INVOKER` (default) and validate inputs.
- Policy: never load `db/test/helpers.sql` in production. Only apply it in local
  development or CI environments.

The repo’s compose files already use `db8_test` to make the test/non‑test split
unambiguous.

## Web App (Next.js)

```text
npm --prefix web install
# Optionally set API base URL (defaults to <http://localhost:3000>)
export NEXT_PUBLIC_DB8_API_URL=<http://localhost:3000>
npm --prefix web run dev   # <http://localhost:3001>
```text

Try: <http://localhost:3001/room/00000000-0000-0000-0000-0000000000ab>

## CLI (local API)

```text
# optional link: npm link
DB8_API_URL=<http://localhost:3000> db8 room status --room
00000000-0000-0000-0000-0000000000ab --json
DB8_API_URL=<http://localhost:3000> db8 room watch  --room
00000000-0000-0000-0000-0000000000ab --json
```text

## Notes

- CI applies `db/schema.sql` and `db/rpc.sql`. pgTAP runs only when enabled (set
  RUN_PGTAP=1 in workflow dispatch or run `db/test/run.sh` locally).
- The server falls back to in-memory idempotent storage if `DATABASE_URL` is not
  set.
- Configuration uses `SecretSource` + `ConfigBuilder`; only the EnvSecretSource
  module reads environment variables. ````
`````
