---
lastUpdated: 2025-10-06
---

# Getting Started

This guide helps you run db8 locally and try the CLI and server.

## Prerequisites

- Node 20+
- Docker (for local Postgres) if you want DB persistence

## Clone & bootstrap

```bash
git clone <https://github.com/flyingrobots/db8.git>
cd db8
npm install
./scripts/bootstrap.sh   # enables commit hooks (optional for contributors)
```

## Run a local DB (optional)

```bash
npm run dev:db      # starts Postgres 16 on localhost:54329
```

Set `DATABASE_URL=postgresql://postgres:test@localhost:54329/db8_test`
in your shell
if you want the server to persist submissions/votes. Without it, the server uses
in‑memory storage with idempotency.

To apply the M1 schema and SQL RPCs to your local DB and optionally run pgTAP
invariants, see docs/LocalDB.md.

Note: test-only SQL helpers live in `db/test/helpers.sql` and refuse to run
unless the database name is clearly a test database (e.g., `db8_test`). Do not
load them in production.

## Start the server

```bash
node server/rpc.js   # listens on :3000
```

Environment flags (M2)

- `CANON_MODE=sorted|jcs` — switch canonicalization mode (default is `jcs`, RFC 8785).
- `ENFORCE_SERVER_NONCES=1` — require server-issued nonces for submissions.
- `SIGNING_PRIVATE_KEY` / `SIGNING_PUBLIC_KEY` — PEM Ed25519 keypair to sign
  journals (dev keypair is generated if unset).

Endpoints (canonical realtime = SSE):

- `GET /state` — returns the active round snapshot, continue tally, and transcript
- `GET /events?room_id=<uuid>` — SSE stream of realtime events
  - event: timer
    - t: "timer"
    - room_id: string (uuid)
    - ends_unix: number (unix seconds)
    - round_idx: number
    - phase: "submit" | "published" | "final"
    - Example frame:

  ```json
  {
    "t": "timer",
    "room_id": "00000000-0000-0000-0000-0000000000ab",
    "ends_unix": 1730505600,
    "round_idx": 0,
    "phase": "submit"
  }
  ```

  - event: phase (emitted on DB NOTIFY when `rounds` change)
    - t: "phase"
    - room_id: string (uuid)
    - round_id: string (uuid)
    - idx: number
    - phase: "submit" | "published" | "final"
    - submit_deadline_unix?: number
    - published_at_unix?: number
    - continue_vote_close_unix?: number
    - Example frame:

  ```json
  {
    "t": "phase",
    "room_id": "00000000-0000-0000-0000-0000000000ab",
    "round_id": "00000000-0000-0000-0000-0000000000ac",
    "idx": 0,
    "phase": "published",
    "published_at_unix": 1730505601,
    "continue_vote_close_unix": 1730505631
  }
  ```

  - Errors
    - HTTP error responses: 4xx/5xx with JSON body `{ ok:false, error:string }`
  - SSE connection guidance: use EventSource with default retry;
    if disconnected, reconnect and also fetch `GET /state` to resync
    authoritative state.

- `POST /rpc/submission.create` — accepts a validated submission and returns `{
ok, submission_id, canonical_sha256 }`
- `POST /rpc/vote.continue` — idempotent continue vote; returns `{ ok, vote_id
}`

Journals

- `GET /journal?room_id=<uuid>` — latest signed journal (JSON)
- `GET /journal?room_id=<uuid>&idx=<n>` — journal by index (DB row when stored;
  synthesized latest in memory mode)
- `GET /journal/history?room_id=<uuid>` — list of journals (for history pages / CLI verify)

## Run tests

```bash
npm test
```

The default suite exercises the in-memory server. To run the live Postgres tests
(the same ones CI executes on every build), start the docker Postgres service
first and pass the Postgres environment variables:

```bash
npm run dev:db
RUN_PGTAP=1 \
DB8_TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/db8_test \
npm test
```

Setting `RUN_PGTAP=1` will also enable pgTAP if `db/test/run.sh` is present.
Shut the database down with `npm run stop:db` when you're finished.

## CLI quickstart (local)

The CLI is provided as a local binary in this repo under `bin/db8.js`.

```bash
npm link         # optional: makes `db8` available on your PATH
db8 whoami       # prints identity (from ~/.db8/session.json if present)
db8 room status  # fetches /state (set DB8_API_URL if not localhost)
```

Draft & submit flow (demo)

```bash
# Create a draft for local round 0 and participant anon
db8 draft open
# Edit the file printed (./db8/round-0/anon/draft.json)
db8 draft validate
db8 submit   # requires DB8_ROOM_ID, DB8_PARTICIPANT_ID, DB8_JWT if server
enforces auth
```

Environment variables

- `DB8_API_URL` (default: <http://localhost:3000>)
- `DB8_ROOM_ID`, `DB8_PARTICIPANT_ID`, `DB8_JWT` — for authenticated flows (not
  required for the stub server)

## Troubleshooting

- Rollup native dependency error on Linux CI runners (optional info for
  contributors): this repo includes an `optionalDependencies` entry for
  `@rollup/rollup-linux-x64-gnu` and a `postinstall` guard to avoid test
  failures on GH Actions.

## Optional: run the DB watcher

The watcher flips rounds at deadlines using SQL RPCs and relies on DB triggers
to fan out changes via SSE.

```bash
export DATABASE_URL=postgresql://postgres:test@localhost:54329/db8_test
node server/watcher.js
```

You should see phase changes reflected in `/events` as `event: phase` messages
when deadlines are crossed.

## Next steps

- Read the architecture: docs/Architecture.md
- Explore features & user stories: docs/Features.md, docs/UserStories.md
- CLI reference/spec: docs/CLI.md
