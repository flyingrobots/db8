---
lastUpdated: 2025-10-07
---

# db8

Debate engine with provenance, journals, and deterministic behavior.

## Roadmap Progress

███████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░
| | | | | | | |
0 M1 M2 M3 M4 M5M6 M7

Milestones (weighted cumulative positions):

- M0: Repo & Docs — weight: 0 — state: closed
- M1: MVP Loop — weight: 125 — state: closed
- M2: Provenance — weight: 95 — state: closed
- M3: Verification — weight: 39 — state: open
- M4: Votes & Final — weight: 29 — state: open
- M5: Scoring & Elo — weight: 16 — state: open
- M6: Research Tools — weight: 12 — state: open
- M7: Hardening & Ops — weight: 20 — state: open

Weights: priority/p0=8, p1=5, p2=3, p3=1, default=1. Positions are cumulative by milestone (e.g., M2 includes M1+M2).

## Quickstart

- Node 20+ (see )
- Install:
  > db8@0.0.0 postinstall
  > node -e "try{require('@rollup/rollup-linux-x64-gnu');process.exit(0)}catch(e){process.exit(1)}" || npm i @rollup/rollup-linux-x64-gnu@latest || true

up to date, audited 712 packages in 1s

245 packages are looking for funding
run `npm fund` for details

found 0 vulnerabilities

> db8@0.0.0 prepare
> git config core.hooksPath .githooks

added 67 packages, removed 2 packages, changed 8 packages, and audited 712 packages in 2s

245 packages are looking for funding
run `npm fund` for details

found 0 vulnerabilities

- Optional Postgres:
  > db8@0.0.0 dev:db
  > docker compose up -d db && sleep 2 && echo 'DB on :54329'

DB on :54329 (localhost:54329)

- Tests:
  > db8@0.0.0 test
  > if [ "$CI" = "true" ]; then npm run test:inner; else npm run test:docker; fi

> db8@0.0.0 test:docker
> bash ./scripts/test-docker.sh (docker-backed) or
> db8@0.0.0 test:inner
> vitest run

RUN v3.2.4 /Users/james/git/db8

✓ server/test/cli.login.test.js (2 tests) 706ms
✓ CLI login + whoami (session file) > stores session and whoami reflects it 522ms
✓ server/test/cli.provenance.enroll.test.js (1 test) 782ms
✓ CLI provenance enroll > enrolls with --pub-b64 and prints normalized fingerprint 781ms
✓ server/test/cli.provenance.verify.test.js (1 test) 774ms
✓ CLI provenance verify > verifies ed25519 signature and prints hash + fingerprint 773ms
✓ server/test/cli.provenance.verify.ssh.test.js (1 test) 815ms
✓ CLI provenance verify (ssh-ed25519) > verifies a doc with --kind ssh and --pub-ssh 814ms
✓ server/test/watcher.transitions.test.js (1 test) 598ms
✓ Watcher transitions (authoritative timers) > submit -> published, then to next round when continue=yes wins 596ms
✓ server/test/cli.journal.verify.test.js (2 tests) 917ms
✓ CLI journal verify > verifies latest journal signature 756ms
✓ server/test/cli.journal.pull.test.js (2 tests) 480ms
✓ CLI journal pull > pulls journal history to output directory 309ms
✓ server/test/cli.room.watch.test.js (3 tests) 559ms
✓ server/test/rate_limit.test.js (2 tests) 191ms
✓ server/test/cli.submit.test.js (1 test) 200ms
✓ server/test/cli.room.status.test.js (1 test) 195ms
✓ server/test/provenance.verify.binding.test.js (2 tests) 188ms
✓ server/test/provenance.verify.ssh.test.js (3 tests) 176ms
✓ server/test/cli.flag.test.js (1 test) 234ms
✓ server/test/participant.fingerprint.set.test.js (3 tests) 164ms
✓ server/test/cli.room.create.test.js (1 test) 244ms
✓ server/test/nonce.enforce.test.js (3 tests) 1321ms
✓ Server-issued nonces (enforced) > rejects expired nonce (ttl) 1209ms
✓ server/test/rpc.db.integration.test.js (2 tests) 41ms
✓ server/test/provenance.verify.enforce.test.js (1 test) 169ms
✓ server/test/journal.test.js (1 test) 171ms
✓ server/test/provenance.verify.test.js (5 tests) 215ms
✓ server/test/state.enrichment.test.js (2 tests) 268ms
✓ server/test/rpc.submission_flag.test.js (2 tests) 76ms
✓ server/test/rpc.vote_continue.test.js (1 test) 125ms
✓ server/test/rpc.room_create.test.js (2 tests) 276ms
✓ server/test/config.builder.test.js (2 tests) 2ms
✓ server/test/rpc.submission_create.test.js (1 test) 151ms
✓ server/test/canonicalization.test.js (3 tests) 6ms
✓ server/test/rpc.submission_deadline.test.js (1 test) 36ms
↓ server/test/rpc.validation.test.js (3 tests | 3 skipped)
✓ server/test/sse.timers.test.js (1 test) 27ms
↓ server/test/journal.byidx.test.js (2 tests | 2 skipped)
✓ server/test/rpc.submission_validation.test.js (1 test) 100ms
↓ web/test/e2e.room.flow.spec.js (1 test | 1 skipped)
↓ server/test/rpc.db.postgres.test.js (2 tests | 2 skipped)
↓ server/test/watcher.db.flip.test.js (1 test | 1 skipped)
↓ server/test/sse.db.events.test.js (1 test | 1 skipped)
↓ server/test/sse.db.journal.test.js (1 test | 1 skipped)

Test Files 31 passed | 7 skipped (38)
Tests 55 passed | 8 skipped | 3 todo (66)
Start at 16:31:33
Duration 3.68s (transform 604ms, setup 298ms, collect 7.09s, tests 10.20s, environment 4ms, prepare 3.56s)

- CLI help: db8 CLI (skeleton)
  Usage: db8 <command> [options]

Global options:
--room <uuid> override room
--participant <uuid> override participant
--json machine-readable output
--quiet suppress non-errors
--non-interactive fail instead of prompting
--timeout <ms> RPC timeout
--nonce <id> client idempotency key

Commands:
login obtain a room-scoped JWT (add --device-code for interactive flow)
whoami print current identity
room status show room snapshot
room watch stream events (WS/SSE)
room create create a new room (server RPC)
draft open create/open draft.json
draft validate validate and print canonical sha
submit submit current draft
resubmit resubmit with a new nonce
flag submission report a submission to moderators
journal pull download journal (latest or history)
journal verify verify journal signature and chain
provenance enroll enroll a participant fingerprint (author binding)
provenance verify verify a submission signature (ed25519 or ssh)

## Highlights

- RFC 8785 JCS canonicalization (default) for deterministic hashing
- Provenance verify (Ed25519, OpenSSH Ed25519) with optional author binding
- Server-issued nonces (issue/enforce)
- Journals: per-round core, chain hash, Ed25519 signature; endpoints + CLI verify
- SSE: realtime timers, phase, and journal events

## Layout

- — RPCs, SSE, watcher, journal signer
- — CLI ()
- — schema, RPCs, RLS, test helpers
- — Next.js demo UI
- — architecture & guides

## Contributing

- Conventional Commits; CI runs lint + tests
- Use Issues + Project “db8 Roadmap”; follow AGENTS.md for hygiene

## Milestone Focus

- M0: Repo & Docs — scaffolding, docs, and CI wiring to enable disciplined development.
- M1: MVP Loop — room/round lifecycle, submit/continue flow, basic CLI + web snapshot.
- M2: Provenance & Journals — JCS canonicalization, client provenance verify (SSH/Ed25519), author binding, signed journals, CLI verify.
- M3: Verification — per-claim verification verdicts, server/CLI flows, and minimal UI for the verification phase.
- M4: Votes & Final — continue/no-continue flows to finalize debates, tally exposure, and transitions to “final”.
- M5: Scoring & Elo — scoring models, per-user/participant ratings, and leaderboards.
- M6: Research Tools — exports, analytics hooks, and E2E scripts to support research scenarios.
- M7: Hardening & Ops — security reviews, rate limiting and quotas, packaging, and operational runbooks.
