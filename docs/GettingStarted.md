# Getting Started

This guide helps you run db8 locally and try the CLI and server.

## Prerequisites

- Node 20+
- Docker (for local Postgres) if you want DB persistence

## Clone & bootstrap

```
git clone https://github.com/flyingrobots/db8.git
cd db8
npm install
./scripts/bootstrap.sh   # enables commit hooks (optional for contributors)
```

## Run a local DB (optional)

```
npm run dev:db      # starts Postgres 16 on localhost:54329
```

Set `DATABASE_URL=postgresql://postgres:test@localhost:54329/db8` in your shell if you want the server to persist submissions/votes. Without it, the server uses in‑memory storage with idempotency.

To apply the M1 schema and SQL RPCs to your local DB and optionally run pgTAP invariants, see docs/LocalDB.md.

## Start the server

```
node server/rpc.js   # listens on :3000
```

Endpoints:

- `GET /state` — returns `{ ok:true, rounds:[], submissions:[] }` (stub)
- `POST /rpc/submission.create` — accepts a validated submission and returns `{ ok, submission_id, canonical_sha256 }`
- `POST /rpc/vote.continue` — idempotent continue vote; returns `{ ok, vote_id }`

## CLI quickstart (local)

The CLI is provided as a local binary in this repo under `bin/db8.js`.

```
npm link         # optional: makes `db8` available on your PATH
db8 whoami       # prints identity (from ~/.db8/session.json if present)
db8 room status  # fetches /state (set DB8_API_URL if not localhost)
```

Draft & submit flow (demo)

```
# Create a draft for local round 0 and participant anon
db8 draft open
# Edit the file printed (./db8/round-0/anon/draft.json)
db8 draft validate
db8 submit   # requires DB8_ROOM_ID, DB8_PARTICIPANT_ID, DB8_JWT if server enforces auth
```

Environment variables

- `DB8_API_URL` (default: http://localhost:3000)
- `DB8_ROOM_ID`, `DB8_PARTICIPANT_ID`, `DB8_JWT` — for authenticated flows (not required for the stub server)

## Troubleshooting

- Rollup native dependency error on Linux CI runners (optional info for contributors): this repo includes an `optionalDependencies` entry for `@rollup/rollup-linux-x64-gnu` and a `postinstall` guard to avoid test failures on GH Actions.

## Next steps

- Read the architecture: docs/Architecture.md
- Explore features & user stories: docs/Features.md, docs/UserStories.md
- CLI reference/spec: docs/CLI.md
