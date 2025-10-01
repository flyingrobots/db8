# AGENTS.md

This file gives the coding agent (you) conventions and checkpoints for working in this repo.

Scope

- Applies to all files in this repository.
- Keep changes small and focused; follow the guardrails below.

Progress tracking

- Primary tracker: GitHub Project “db8 Roadmap”.
- Use labels and milestones already created (area/_, type/_, priority/\*, M1–M7).
- When you open PRs, link the corresponding issues and set the milestone.

Pull requests

- Use Markdown in PR bodies (no HTML). Lead with a short Summary and bullet points for Changes, Tests, and Next.
- Always include issue auto-closures when applicable: “Fixes #<n>”, “Closes #<n>”, or “Partially addresses #<n>”.
- Set the correct milestone and labels on the PR.

Board hygiene

- Keep statuses accurate on the Project board:
  - New M1 issues: set Status = “Todo”.
  - Actively working: set Status = “In Progress”.
  - PR opened: add label `status/in-review` (and optionally move to an “In Review” column if available).
  - Merged/Done: set Status = “Done” and close the issue.
- Add missing issues/PRs to the project when discovered.

Workflow loop (daily driver)

0. Issue hygiene
   - If there is a GitHub issue for the task: update its Status/Workflow.
   - If there is no issue: create one (title, acceptance criteria, milestone), add it to the Project, set Status/Workflow.

1. Tests first
   - If a test exists: run it. If it fails → there is work to do → go to 2.
   - If no test exists: write a focused test capturing the invariant, then go to 1 (run it).
   - If the test passes: the task is done.

2. Code → test → iterate
   - Implement minimal code to satisfy the test; keep the change small.
   - Re‑run tests and iterate until green.

3. Documentation
   - If docs exist: update them.
   - If docs don’t exist: write them and link them from the nearest MoC (e.g., README or docs/GettingStarted.md).

4. PR and issue updates
   - Update the issue (notes, links), set Workflow=In Review.
   - Open a PR with a Markdown body (Summary / Changes / Tests / Next) and include “Fixes #<n>”.
   - Enable auto‑merge (Merge method) when checks/approvals are green.
   - On merge: close the issue (auto via Fixes), set Status/Workflow=Done, and delete the branch.

Working style

- JavaScript-only across web, server, and CLI. No TypeScript.
- Validate inputs with Zod at the edges.
- Keep server and watcher small; heavy work belongs in Supabase (SQL/RPC/RLS) or the worker.
- Deterministic behavior: prefer stable hashing, canonical JSON, advisory locks.

Guardrails (enforced by repo config)

- Node 20+. See .nvmrc.
- ESLint + Prettier. See eslint.config.js and .prettierrc.
- Git hooks for lint-staged and commit message checks.
- CI runs lint and tests with a real Postgres service.
- History hygiene: never amend, rebase, or force-push shared branches. Always add new commits and resolve forward.

Test-first checklist (M1)

1. Write/adjust pgTAP invariants for rooms/rounds/submissions.
2. Write minimal Vitest tests for canonical JSON and RPC schema validation.
3. Keep E2E smoke as a placeholder (skip) until routes exist.

Local dev

- Run: `docker compose -f docker-compose.test.yml up -d db`
- Set env: copy `.env.example` to `.env` and fill values as needed.
- Prepare hooks: `git config core.hooksPath .githooks && chmod +x .githooks/*`

Project board

- Project name: db8 Roadmap
- Columns: use the Status field (Todo / In Progress / Done).
- Add new issues to the project and set Status.

Links

- Features: docs/Features.md
- Architecture: docs/Architecture.md
- User stories: docs/UserStories.md

Operational notes (for future‑you)

- Merge methods
  - Repo allows Merge and Rebase; Squash is disabled. Use Merge in gh/PR UI unless Rulesets require linear history (then use Rebase).
  - Auto‑merge: enable per‑PR (UI or `gh pr merge <n> --merge --auto`) after required checks/approvals are green.
  - Rulesets vs legacy protection: REST `branches/*/protection` 404 is normal if using Rulesets. Ensure required checks match names exactly (`build-test`, `conventional-commits`).

- CI stability (Linux runners)
  - Rollup native optional dep can fail on `npm ci`. We added:
    - `optionalDependencies`: `@rollup/rollup-linux-x64-gnu`
    - `postinstall` guard to install it if missing
    - CI install fallback to clean `npm install` if `npm ci` flakes
  - Keep `package-lock.json` committed for `setup-node` cache.

- Runtime configuration
  - Node 20+ enforced (`.nvmrc`, engines, CI). No TypeScript.
  - Zod at edges.
  - `DATABASE_URL` optional. If set, endpoints try DB persistence with in‑memory idempotent fallback.
  - pgTAP scaffolded; gated via workflow_dispatch or `RUN_PGTAP=1`.

- Project workflow
  - Fields: Status (Todo/In Progress/Done) and Workflow (Todo/In Progress/In Review/Done).
  - New milestone issue → Status=Todo, Workflow=Todo.
  - Active coding → Status=In Progress, Workflow=In Progress.
  - PR opened → Workflow=In Review (+ label `status/in-review` if filtering helps).
  - Merged → Status=Done, Workflow=Done; close issue via “Fixes #<n>”.

- Branch & PR conventions
  - Branch names: `feat/...`, `fix/...`, `chore/...`.
  - Titles: Conventional Commits (e.g., `feat(server): vote.continue endpoint`).
  - Labels: `area/*`, `type/*`, `priority/*`; set milestone (M1–M7) and link issues.

- Tests
  - Local: `npm install && npm test` (Vitest). Skipped E2E placeholders are fine.
  - DB: `docker compose up -d db`; pgTAP: `db/test/run.sh` when needed.

- Endpoints delivered (M1)
  - `POST /rpc/submission.create` — Zod, canonicalization, idempotent by `(room, round, author, client_nonce)`, optional DB.
  - `POST /rpc/vote.continue` — Zod, idempotent by `(round, voter, kind, client_nonce)`, optional DB.
  - `GET /state` — stub snapshot.

---

## Agent Log — 2025-09-26

Summary of work completed end-to-end today:

- Lint/CI pipeline
  - Fixed ESLint blocking issues; added `.npm-cache/` to `.gitignore`.
  - Introduced a dedicated web lint config, then unified to a single root ESLint with alias resolver (`@ -> ./web`).
  - Updated `lint-staged` to avoid ignored-file warnings; CI now installs `web/` dependencies and caches both lockfiles.

- CLI
  - Implemented `login` (stores `~/.db8/session.json`) and verified `whoami` output.
  - Polished `room status` (phase + timers + tally) and made `room watch` robust; added test-only single-event escape.
  - Added focused Vitest for `login`, `room status`, and `room watch`.

- Worker/Server
  - Authoritative timers: `/events` uses real round deadlines (submit/continue windows).
  - Fixed continue tally key in phase transition.
  - Added watcher transition test with fake timers.

- Web (Next.js)
  - New `Room` page `/room/[roomId]`: snapshot + SSE countdown, submit stub in `submit` phase, continue tally otherwise.
  - Polish: client-side Zod validation, inline error/success, localStorage convenience.

- Database (M1)
  - Schema: `rooms`, `rounds`, `submissions`, `votes` with idempotency uniques and indexes.
  - SQL RPCs: `submission_upsert`, `vote_submit`, `round_publish_due`, `round_open_next`.
  - Views: `view_current_round`, `view_continue_tally`.
  - pgTAP: invariants for tables/uniques/views and RPC existence + idempotency; optional runner documented.

- Configuration
  - Introduced `SecretSource` + `ConfigBuilder`; eliminated direct `process.env` usage from server.

- Documentation
  - Added `docs/LocalDB.md` and linked it from `docs/GettingStarted.md`.

- Project hygiene
  - Synced the “db8 Roadmap” project items; set active issues to In Progress and PRs to In Review where applicable.

PRs (labels/milestone set, auto-merge enabled where appropriate):

- #43 feat(cli): login stores session; whoami reads it — merged
- #44 feat(cli): room status formatter and watch lifecycle — merged (Closes #26)
- #45 feat(worker): authoritative timers + SSE bound to deadlines — merged (Closes #3)
- #46 feat(web): Room page with countdown, submit stub, tally — merged (Closes #5)
- #47 feat(web): Room page polish (Zod, inline errors) — merged
- #48 feat(db): M1 schema, views, and SQL RPCs — open/in review (Closes #1; Partially #2)

## Next Moves (Plan)

Short-term (M1 wrap):

- `/events` + sync: stream countdown and transcript updates from the DB path; consider polling + diff as an interim step.
- `/state` enrichment follow-up: replace demo round IDs with real DB-issued IDs and surface published_at / continue_close UNIX fields consistently.
- CI hygiene: document the new Postgres suite trigger (`RUN_PGTAP` or workflow input) and decide if/when to promote it to always-on.
- CLI polish: device-code/magic-link stub (#25) and `--dry-run` submit path from issue #6 once transcripts land.

Medium-term (hexagonal preparation):

- Define ports (interfaces) under `server/ports/` for Repos, Clock, Id, Events.
- Implement adapters: PG and in-memory repos, Express controllers, SSE publisher.
- Migrate use-cases into `server/app/` with Zod at edges; keep deterministic behavior and easy unit tests.

Operational/CI:

- Evaluate enabling pgTAP + Postgres suite in a dedicated job once runtime stabilizes.
- Continue Project board hygiene (Status/Workflow updates on issue start, PR open, and merge).

## Agent Log — 2025-09-27

### Work completed

- Server
  - `/rpc/submission.create` and `/rpc/vote.continue` call the SQL RPCs when `DATABASE_URL` is present, leaving the in-memory fallback for failures.
  - `/state` now pulls the active round, tally, and transcript from Postgres (with deterministic fallback) and keeps transcript metadata in memory for demos.
  - Added `__setDbPool` for tests, a stubbed PG pool spec, and a live Postgres Vitest suite that verifies persistence plus `/state` output.
- Web
  - Room and Spectator pages render the transcript (author, timestamp, canonical hash) returned by `/state`; submit card now reports transcript count.
- CI / Issues
  - CI workflow runs the Postgres RPC suite when `RUN_PGTAP` or `run_pgtap` is enabled.
  - Logged follow-ups: #49 (docker-backed SQL RPC tests) and #50 (surface transcript) — both addressed here; remaining items tracked in updated plan.

### Next up

- Wire `/events` to emit DB-backed updates (or poll + diff) so the web UI sees transcript changes without refresh.
- Expose richer `/state` metadata (e.g., published timestamps, vote window) once round lifecycle RPCs are exercised.
- Decide on promotion of live-DB tests in CI and keep documentation current for contributors.

## Agent Log — 2025-09-29

### Work completed

- Database / RPCs
  - Added `participants` table with role constraint (`debater|host|judge`), round/participant foreign keys, and supporting indexes/tests.
  - Hardened `room_create`: unique `client_nonce`, idempotent `ON CONFLICT` insert, bounded inputs (`participant_count` 1..64, `submit_minutes` 1..1440), moved epoch math to `bigint`, and simplified seeding to rely on SQL idempotency.
  - Documented the room creation contract (signature, defaults, nonce usage) in `docs/LocalDB.md` and added pgTAP coverage for happy path, idempotency reuse counts, boundary acceptance, and failure cases.
  - Tightened `vote_submit` (allowed kinds + `ON CONFLICT … DO UPDATE` returning) and ensured zero-vote rounds finalize via COALESCE logic in both the RPC and `view_continue_tally`.
- Tests / Tooling
  - Expanded pgTAP suite (constraint/index checks, room_create invariants, submission/vote idempotency, finalize-without-votes).
  - Updated Postgres Vitest fixture to seed participants, truncate optional tables safely, and exercise the DB path without fallback.
  - Removed redundant submission nonce index; clarified docstrings/comments.
- Docs / Process
  - Clarified `room_create` usage in docs and recorded the no-force-push policy in `AGENTS.md`.

### Problems encountered

- Occasional Vitest watcher/rate-limit socket errors during rapid reruns; rerunning cleared them (not consistently reproducible).
- Early force-push/amend usage prompted policy update (no history rewrites going forward).

### Follow-ups / unresolved

- Schema migration still needed to alter `rounds.*_unix` columns to `bigint` (logic already assumes it).
- Wire the new `room_create` RPC into server/CLI flows and expose it via API.
- Add higher-level tests for moderator flag surfacing and vote kind validation.

### Next session starter

- Begin by integrating `room_create` into server/CLI workflows (include client nonce handling) and verify end-to-end room creation.
- Check PR #61 status; merge if CI is green, then move on to auth/moderation follow-ups.

## Agent Log — 2025-10-01

### Resequencing & Realtime Decision

- Canonical realtime path set to Server SSE backed by DB LISTEN/NOTIFY. Supabase Realtime is optional for mirroring.
- Updated docs (Architecture.md, GettingStarted.md) to reflect SSE canonical endpoint `/events`.

### Work completed

- Server
  - Promoted `/events` to DB-backed SSE: listens on channel `db8_rounds` and emits `event: phase` and `event: timer` (derived from DB deadlines).
  - Added `notify_rounds_change()` trigger on `rounds` (AFTER INSERT/UPDATE) to `db/rpc.sql`.
  - Aligned submission phase enums across Server/CLI/Web to `submit|published|final`.
  - Introduced `server/watcher.js` with `runTick()` and `startWatcher()` that call `round_publish_due()` and `round_open_next()`.
- Tests
  - Added DB-backed SSE test `server/test/sse.db.events.test.js` (proves NOTIFY→phase emission, no poll/diff).
  - Added DB watcher flip test `server/test/watcher.db.flip.test.js` (submit→published when deadline passed).
  - Updated existing tests for phase enum alignment; skipped flaky in-memory transition test pending RLS/authoritative watcher integration.
- Docs & Backlog
  - Added `docs/Backlog-2025-10-01.md` with `gh` CLI one-liners for 10 tasks aligned to milestones.

### Plan updates

- M1 wrap focuses on:
  - Authoritative watcher loop in production mode.
  - RLS + secure views enforcement with pgTAP coverage.
  - Phase contract alignment (done).
- M2 will deliver:
  - JCS canonicalization (RFC 8785), server-issued nonces, SSH/Ed25519 provenance, server checkpoint signatures, journals, CLI verify.
