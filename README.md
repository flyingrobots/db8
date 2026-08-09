---
lastUpdated: 2025-12-23
---

# db8

A small, deterministic debate engine with cryptographic provenance, signed journals, and a pragmatic CLI/server/web stack.

## Roadmap Progress

The bar below shows cumulative progress by milestone. Marker positions are
weighted by open+closed issue counts (priority weights: p0=8, p1=5, p2=3, p3=1, default=1).
Each milestone marker includes all tasks from prior milestones (e.g., M2 = M1+M2).

```text
████████████████████████████████████████████████████████████
|                    |                |      |    |  | |   |
0                   M1               M2     M3   M4 M5M6  M7
```

## Milestone Focus

- M1: MVP Loop — Complete.
- M2: Provenance & Journals — Complete.
- M3: Verification — Complete.
- M4: Votes & Final — Complete.
- M5: Scoring & Elo — Complete.
- M6: Research Tools — Complete.
- M7: Hardening & Ops — Complete.

## Quickstart

- Requirements: Node 20+ (see `.nvmrc`). Docker optional for Postgres.
- Install: `npm install`
- Optional Postgres (local): `npm run dev:db` (starts Postgres on 54329)
- Tests: `npm test` (docker‑backed) or `npm run test:inner`
- CLI help: `node bin/db8.js help`

## Highlights

- **Deterministic Causal Kernel**: Authoritative watcher loop with heartbeat recovery.
- **Cryptographic Provenance**: RFC 8785 JCS canonicalization and SSH/Ed25519 signing.
- **Signed Journals**: Per-round core data, chain hash, and Ed25519 signatures.
- **Structured Verification**: Per-claim moderate verdicts with real-time updates.
- **Reputation System**: Deterministic Elo updates globally and by topic tag.
- **Research Infrastructure**: URL snapshotting, deduplicated cache, and fetch quotas.
- **Production Hardening**: Rate limiting, Dead Letter Queue (pgmq), and persistent keys.
- **SSE Streams**: Real-time timers, phase changes, and journal events.

## Repository Layout

- `server/` — Express RPCs, SSE endpoints, watcher, journal signer
- `bin/` — CLI (`db8`)
- `db/` — Postgres schema, RPCs, RLS, and test helpers
- `web/` — Next.js demo UI (room snapshot, journal viewer)
- `docs/` — architecture, feature docs, guides

See also: docs/Verification.md

## Contributing

- Conventional Commits; CI runs lint + tests
- Use Issues + Project “db8 Roadmap”; follow AGENTS.md for milestone/board hygiene
