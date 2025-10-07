---
lastUpdated: 2025-10-07
---

# db8

A small, deterministic debate engine with cryptographic provenance, signed journals, and a pragmatic CLI/server/web stack.

## Roadmap Progress

The bar below shows cumulative progress by milestone. Marker positions are
weighted by open+closed issue counts (priority weights: p0=8, p1=5, p2=3, p3=1, default=1).
Each milestone marker includes all tasks from prior milestones (e.g., M2 = M1+M2).

```text
███████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░
|                    |                |      |    |  | |   |
0                   M1               M2     M3   M4 M5M6  M7
```

## Milestone Focus (what you can do)

- M0: Repo & Docs — clean repo, docs, and CI wiring to enable disciplined
  development.
- M1: MVP Loop — create rooms/rounds, submit content, continue votes, and see a
  live room snapshot and timers in the UI/CLI.
- M2: Provenance & Journals — canonicalize (RFC 8785 JCS), verify client
  signatures (Ed25519 or OpenSSH ed25519), optional author binding, signed
  per‑round journals, and CLI journal pull/verify.
- M3: Verification — record per‑claim verification verdicts (schema/RPC/CLI) and
  surface minimal verification UI.
- M4: Votes & Final — continue/no‑continue flows to finalize debates; expose
  tallies and transitions to “final”.
- M5: Scoring & Elo — scoring model and participant ratings; basic leaderboards.
- M6: Research Tools — exports, analytics hooks, and E2E scripts to support
  research scenarios.
- M7: Hardening & Ops — security reviews, rate limiting/quotas, packaging, and
  operational run books.

## Quickstart

- Requirements: Node 20+ (see `.nvmrc`). Docker optional for Postgres.
- Install: `npm install`
- Optional Postgres (local): `npm run dev:db` (starts Postgres on 54329)
- Tests: `npm test` (docker‑backed) or `npm run test:inner`
- CLI help: `node bin/db8.js help`

## Highlights

- RFC 8785 JCS canonicalization (default) for deterministic hashing
- Provenance verify (Ed25519 + OpenSSH ed25519); optional strict author binding
- Server‑issued nonces (issue + enforce) for idempotent submissions
- Journals: per‑round core, chain hash, Ed25519 signature; endpoints + CLI verify
- SSE: realtime timers, phase changes, and journal events

## Repository Layout

- `server/` — Express RPCs, SSE endpoints, watcher, journal signer
- `bin/` — CLI (`db8`)
- `db/` — Postgres schema, RPCs, RLS, and test helpers
- `web/` — Next.js demo UI (room snapshot, journal viewer)
- `docs/` — architecture, feature docs, guides

## Contributing

- Conventional Commits; CI runs lint + tests
- Use Issues + Project “db8 Roadmap”; follow AGENTS.md for milestone/board hygiene
