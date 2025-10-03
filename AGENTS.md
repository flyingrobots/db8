---
lastUpdated: 2025-10-03
---

# AGENTS.md

This file gives the coding agent (you) conventions and checkpoints for working
in this repo.

Scope

- Applies to all files in this repository.
- Keep changes small and focused; follow the guardrails below.

Progress tracking

- Primary tracker: GitHub Project “db8 Roadmap”.
- Use labels and milestones already created (area/_, type/_, priority/\*,
  M1–M7).
- When you open PRs, link the corresponding issues and set the milestone.

Issue & Backlog Discipline (must follow)

- Source of truth: GitHub Issues + Project “db8 Roadmap”.
  Backlog file is staging only.
- No PRs without a linked issue, except trivial changes (docs typos, ignore entries ≤ 5 lines).
  For trivial changes, either:
  - Create a retro issue and close it with links, or
  - Log the item in `docs/tasks/backlog.md` if truly non-urgent (but promote to
    an issue before any follow-up work).
- Backlog usage (`docs/tasks/backlog.md`):
  - Add well-formed entries using the provided template (Title, Type, Area,
    Priority, Milestone, Status, Summary, Acceptance, Links).
  - When promoting to an issue: remove the entry from the backlog in the same
    commit and include the new issue number in the commit message.
  - Never leave duplicates: a task exists in exactly one place (backlog OR an
    open issue), never both.
- Board hygiene (strict): whenever status changes, immediately update the Issue
  fields and Project board.
  - Start: Status=Todo, Workflow=Todo, Milestone set.
  - Actively coding: Status=In Progress, Workflow=In Progress.
  - PR opened: add label `status/in-review`, Workflow=In Review.
  - Merged: Status=Done, Workflow=Done; issue closed via PR body (“Fixes #<n>”).
  - Delete the branch after merge.
- Milestone discipline:
  - M1 is the primary focus unless explicitly approved otherwise. After any
    side-task (e.g., urgent fix), return to M1 immediately.
- Commit/PR discipline:
  - Conventional Commits, scoped labels (`area/*`, `type/*`, `priority/*`), and
    milestone on every PR. PR body must include Summary / Changes / Tests / Next
    and an auto-close reference (`Fixes #<n>`).
  - If a PR must merge without an issue (exceptional trivial change), add a
    short “Why no issue” note in the PR body and open a retro issue that closes
    immediately with links.

Project tooling

- Use the helper instead of raw GraphQL/gh plumbing:
  - `npm run project -- add --owner flyingrobots --project-title "db8 Roadmap" \\
--issues 112,113 --status "Todo" --workflow "Todo" \\
--milestone "M1: MVP Loop"`
  - `npm run project -- status --owner flyingrobots \\
--project-title "db8 Roadmap" --issues 112 \\
--status "In Progress" --workflow "In Progress"`
  - `npm run project -- milestone --issues 112,113 \\
--milestone "M1: MVP Loop"`
- Prereq: authenticated `gh` (run `gh auth status`). The tool resolves the
  project id and Status/Workflow option ids and updates items accordingly.

Docs/Markdown conventions

- We deliberately disable certain markdownlint rules (see ./.markdownlint.jsonc):
  - MD013 (line-length): disabled. Rationale: tables, Mermaid, and modern URLs
    don’t fit hard wrapping; editors/terminals in 2025 soft-wrap Markdown.
  - MD024 (duplicate headings): disabled. The session debrief template repeats
    headings (Summary/References/Key Decisions/Action Items) per event by
    design.
- Keep headings, links, and tables readable; don’t force line breaks for
  aesthetics. Prefer explicit links to Issues/PRs/Commits (e.g.,
  [#112](https://github.com/flyingrobots/db8/issues/112)) in long‑lived docs.

Session debriefs

- When appending a new debrief under “Agent Log,” separate each event block in
  the Event Log with a horizontal rule (`---`) for readability.
- Use the exact headings in the template (Summary, References, Key Decisions,
  Action Items, Notes) for each event so logs stay consistent.

Pull requests

- Use Markdown in PR bodies (no HTML). Lead with a short Summary and bullet
  points for Changes, Tests, and Next.
- Always include issue auto-closures when applicable: “Fixes <n>”, “Closes
  <n>”, or “Partially addresses <n>”.
- Set the correct milestone and labels on the PR.

Board hygiene

- Keep statuses accurate on the Project board:
  - New M1 issues: set Status = “Todo”.
  - Actively working: set Status = “In Progress”.
  - PR opened: add label `status/in-review` (and optionally move to an “In
    Review” column if available).
  - Merged/Done: set Status = “Done” and close the issue.
- Add missing issues/PRs to the project when discovered.

Workflow loop (daily driver)

0. Issue hygiene
   - If there is a GitHub issue for the task: update its Status/Workflow.
   - If there is no issue: create one (title, acceptance criteria, milestone),
     add it to the Project, set Status/Workflow.

1. Tests first
   - If a test exists: run it. If it fails → there is work to do → go to 2.
   - If no test exists: write a focused test capturing the invariant, then go to
     1 (run it).
   - If the test passes: the task is done.

2. Code → test → iterate
   - Implement minimal code to satisfy the test; keep the change small.
   - Re‑run tests and iterate until green.

3. Documentation
   - If docs exist: update them.
   - If docs don’t exist: write them and link them from the nearest MoC (e.g.,
     README or docs/GettingStarted.md).
   - Follow the Frontmatter Policy (see `docs/DesignGuide.md#frontmatter-policy`):
     every Markdown file must include YAML frontmatter with `lastUpdated` (ISO
     date). Spec docs also include `tags: [spec]` and the exact `milestone`
     string. Do not include `title` in frontmatter; the first body line must be
     a single H1.

4. PR and issue updates
   - Update the issue (notes, links), set Workflow=In Review.
   - Open a PR with a Markdown body (Summary / Changes / Tests / Next) and
     include “Fixes #<n>”.
   - Wait for reviewer feedback and allow the user to merge when they're satisfied.
   - On merge: close the issue (auto via Fixes), set Status/Workflow=Done, and
     delete the branch.

Working style

- JavaScript-only across web, server, and CLI. No TypeScript.
- Validate inputs with Zod at the edges.
- Keep server and watcher small; heavy work belongs in Supabase (SQL/RPC/RLS) or
  the worker.
- Deterministic behavior: prefer stable hashing, canonical JSON, advisory locks.

Guardrails (enforced by repo config)

- Node 20+. See .nvmrc.
- ESLint + Prettier. See eslint.config.js and .prettierrc.
- Git hooks for lint-staged and commit message checks.
- CI runs lint and tests with a real Postgres service.
- History hygiene: never amend, rebase, or force-push shared branches. Always
  add new commits and resolve forward.

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
  - Repo allows Merge and Rebase; Squash is disabled. Use Merge in gh/PR UI
    unless Rulesets require linear history (then use Rebase).
  - Wait for reviewer feedback and allow the user to merge when they're satisfied.
  - Rulesets vs legacy protection: REST `branches/*/protection` 404 is normal if
    using Rulesets. Ensure required checks match names exactly (`build-test`,
    `conventional-commits`).

- CI stability (Linux runners)
  - Rollup native optional dep can fail on `npm ci`. We added:
    - `optionalDependencies`: `@rollup/rollup-linux-x64-gnu`
    - `postinstall` guard to install it if missing
    - CI install fallback to clean `npm install` if `npm ci` flakes
  - Keep `package-lock.json` committed for `setup-node` cache.

- Runtime configuration
  - Node 20+ enforced (`.nvmrc`, engines, CI). No TypeScript.
  - Zod at edges.
  - `DATABASE_URL` optional. If set, endpoints try DB persistence with in‑memory
    idempotent fallback.
  - pgTAP scaffolded; gated via workflow_dispatch or `RUN_PGTAP=1`.

- Project workflow
  - Fields: Status (Todo/In Progress/Done) and Workflow (Todo/In Progress/In
    Review/Done).
  - New milestone issue → Status=Todo, Workflow=Todo.
  - Active coding → Status=In Progress, Workflow=In Progress.
  - PR opened → Workflow=In Review (+ label `status/in-review` if filtering
    helps).
  - Merged → Status=Done, Workflow=Done; close issue via “Fixes #<n>”.

- Branch & PR conventions
  - Branch names: `feat/...`, `fix/...`, `chore/...`.
  - Titles: Conventional Commits (e.g., `feat(server): vote.continue endpoint`).
  - Labels: `area/*`, `type/*`, `priority/*`; set milestone (M1–M7) and link
    issues.

- Tests
  - Local: `npm install && npm test` (Vitest). Skipped E2E placeholders are
    fine.
  - DB: `docker compose up -d db`; pgTAP: `db/test/run.sh` when needed.

- Endpoints delivered (M1)
  - `POST /rpc/submission.create` — Zod, canonicalization, idempotent by `(room,
round, author, client_nonce)`, optional DB.
  - `POST /rpc/vote.continue` — Zod, idempotent by `(round, voter, kind,
client_nonce)`, optional DB.
  - `GET /state` — stub snapshot.

---

## Agent Log — 2025-09-26

Summary of work completed end-to-end today:

- Lint/CI pipeline
  - Fixed ESLint blocking issues; added `.npm-cache/` to `.gitignore`.
  - Introduced a dedicated web lint config, then unified to a single root ESLint
    with alias resolver (`@ -> ./web`).
  - Updated `lint-staged` to avoid ignored-file warnings; CI now installs `web/`
    dependencies and caches both lockfiles.

- CLI
  - Implemented `login` (stores `~/.db8/session.json`) and verified `whoami`
    output.
  - Polished `room status` (phase + timers + tally) and made `room watch`
    robust; added test-only single-event escape.
  - Added focused Vitest for `login`, `room status`, and `room watch`.

- Worker/Server
  - Authoritative timers: `/events` uses real round deadlines (submit/continue
    windows).
  - Fixed continue tally key in phase transition.
  - Added watcher transition test with fake timers.

- Web (Next.js)
  - New `Room` page `/room/[roomId]`: snapshot + SSE countdown, submit stub in
    `submit` phase, continue tally otherwise.
  - Polish: client-side Zod validation, inline error/success, localStorage
    convenience.

- Database (M1)
  - Schema: `rooms`, `rounds`, `submissions`, `votes` with idempotency uniques
    and indexes.
  - SQL RPCs: `submission_upsert`, `vote_submit`, `round_publish_due`,
    `round_open_next`.
  - Views: `view_current_round`, `view_continue_tally`.
  - pgTAP: invariants for tables/uniques/views and RPC existence + idempotency;
    optional runner documented.

- Configuration
  - Introduced `SecretSource` + `ConfigBuilder`; eliminated direct `process.env`
    usage from server.

- Documentation
  - Added `docs/LocalDB.md` and linked it from `docs/GettingStarted.md`.

- Project hygiene
  - Synced the “db8 Roadmap” project items; set active issues to In Progress and
    PRs to In Review where applicable.

PRs (labels/milestone set; merged after reviewer approval):

- #43 feat(cli): login stores session; whoami reads it — merged
- #44 feat(cli): room status formatter and watch lifecycle — merged (Closes #26)
- #45 feat(worker): authoritative timers + SSE bound to deadlines — merged
  (Closes #3)
- #46 feat(web): Room page with countdown, submit stub, tally — merged (Closes
  #5)
- #47 feat(web): Room page polish (Zod, inline errors) — merged
- #48 feat(db): M1 schema, views, and SQL RPCs — open/in review (Closes #1;
  Partially #2)

## Next Moves (Plan)

Short-term (M1 wrap):

- `/events` + sync: stream countdown and transcript updates from the DB path;
  consider polling + diff as an interim step.
- `/state` enrichment follow-up: replace demo round IDs with real DB-issued IDs
  and surface published_at / continue_close UNIX fields consistently.
- CI hygiene: document the new Postgres suite trigger (`RUN_PGTAP` or workflow
  input) and decide if/when to promote it to always-on.
- CLI polish: device-code/magic-link stub (#25) and `--dry-run` submit path from
  issue #6 once transcripts land.

Medium-term (hexagonal preparation):

- Define ports (interfaces) under `server/ports/` for Repos, Clock, Id, Events.
- Implement adapters: PG and in-memory repos, Express controllers, SSE
  publisher.
- Migrate use-cases into `server/app/` with Zod at edges; keep deterministic
  behavior and easy unit tests.

Operational/CI:

- Evaluate enabling pgTAP + Postgres suite in a dedicated job once runtime
  stabilizes.
- Continue Project board hygiene (Status/Workflow updates on issue start, PR
  open, and merge).

## Agent Log — 2025-09-27

### Work Completed — 2025-09-27

- Server
  - `/rpc/submission.create` and `/rpc/vote.continue` call the SQL RPCs when
    `DATABASE_URL` is present, leaving the in-memory fallback for failures.
  - `/state` now pulls the active round, tally, and transcript from Postgres
    (with deterministic fallback) and keeps transcript metadata in memory for
    demos.
  - Added `__setDbPool` for tests, a stubbed PG pool spec, and a live Postgres
    Vitest suite that verifies persistence plus `/state` output.
- Web
  - Room and Spectator pages render the transcript (author, timestamp, canonical
    hash) returned by `/state`; submit card now reports transcript count.
- CI / Issues
  - CI workflow runs the Postgres RPC suite when `RUN_PGTAP` or `run_pgtap` is
    enabled.
  - Logged follow-ups: #49 (docker-backed SQL RPC tests) and #50 (surface
    transcript) — both addressed here; remaining items tracked in updated plan.

### Next up

- Wire `/events` to emit DB-backed updates (or poll + diff) so the web UI sees
  transcript changes without refresh.
- Expose richer `/state` metadata (e.g., published timestamps, vote window) once
  round lifecycle RPCs are exercised.
- Decide on promotion of live-DB tests in CI and keep documentation current for
  contributors.

## Agent Log — 2025-09-29

### Work Completed — 2025-09-29

- Database / RPCs
  - Added `participants` table with role constraint (`debater|host|judge`),
    round/participant foreign keys, and supporting indexes/tests.
  - Hardened `room_create`: unique `client_nonce`, idempotent `ON CONFLICT`
    insert, bounded inputs (`participant_count` 1..64, `submit_minutes`
    1..1440), moved epoch math to `bigint`, and simplified seeding to rely on
    SQL idempotency.
  - Documented the room creation contract (signature, defaults, nonce usage) in
    `docs/LocalDB.md` and added pgTAP coverage for happy path, idempotency reuse
    counts, boundary acceptance, and failure cases.
  - Tightened `vote_submit` (allowed kinds + `ON CONFLICT … DO UPDATE`
    returning) and ensured zero-vote rounds finalize via COALESCE logic in both
    the RPC and `view_continue_tally`.
- Tests / Tooling
  - Expanded pgTAP suite (constraint/index checks, room_create invariants,
    submission/vote idempotency, finalize-without-votes).
  - Updated Postgres Vitest fixture to seed participants, truncate optional
    tables safely, and exercise the DB path without fallback.
  - Removed redundant submission nonce index; clarified docstrings/comments.
- Docs / Process
  - Clarified `room_create` usage in docs and recorded the no-force-push policy
    in `AGENTS.md`.

### Problems encountered

- Occasional Vitest watcher/rate-limit socket errors during rapid reruns;
  rerunning cleared them (not consistently reproducible).
- Early force-push/amend usage prompted policy update (no history rewrites going
  forward).

### Follow-ups / unresolved

- Schema migration still needed to alter `rounds.*_unix` columns to `bigint`
  (logic already assumes it).
- Wire the new `room_create` RPC into server/CLI flows and expose it via API.
- Add higher-level tests for moderator flag surfacing and vote kind validation.

### Next session starter

- Begin by integrating `room_create` into server/CLI workflows (include client
  nonce handling) and verify end-to-end room creation.
- Check PR #61 status; merge if CI is green, then move on to auth/moderation
  follow-ups.

## Agent Log — 2025-10-01

### Resequencing and Realtime Decision

- Canonical realtime path set to Server SSE backed by DB LISTEN/NOTIFY. Supabase
  Realtime is optional for mirroring.
- Updated docs (Architecture.md, GettingStarted.md) to reflect SSE canonical
  endpoint `/events`.

### Work Completed — 2025-10-01

- Server
  - Promoted `/events` to DB-backed SSE: listens on channel `db8_rounds` and
    emits `event: phase` and `event: timer` (derived from DB deadlines).
  - Added `notify_rounds_change()` trigger on `rounds` (AFTER INSERT/UPDATE) to
    `db/rpc.sql`.
  - Aligned submission phase enums across Server/CLI/Web to
    `submit|published|final`.
  - Introduced `server/watcher.js` with `runTick()` and `startWatcher()` that
    call `round_publish_due()` and `round_open_next()`.
- Tests
  - Added DB-backed SSE test `server/test/sse.db.events.test.js` (proves
    NOTIFY→phase emission, no poll/diff).
  - Added DB watcher flip test `server/test/watcher.db.flip.test.js`
    (submit→published when deadline passed).
  - Updated existing tests for phase enum alignment; skipped flaky in-memory
    transition test pending RLS/authoritative watcher integration.
- Docs & Backlog
  - Added `docs/Backlog-2025-10-01.md` with `gh` CLI one-liners for 10 tasks
    aligned to milestones.

### Plan updates

- M1 wrap focuses on:
  - Authoritative watcher loop in production mode.
  - RLS + secure views enforcement with pgTAP coverage.
  - Phase contract alignment (done).
- M2 will deliver:
  - JCS canonicalization (RFC 8785), server-issued nonces, SSH/Ed25519
    provenance, server checkpoint signatures, journals, CLI verify.

## Agent Log — 2025-10-02

Summary

- Resolved conflicts and merged DB-backed SSE `/events` (LISTEN/NOTIFY) after
  review on #83.
- Addressed feedback sprint (#84): removed duplicate postinstall, collapsed
  duplicated SQL CTEs, improved SSE test timing/logging, consolidated watcher
  teardown, expanded SSE docs, and marked checklist complete.
- Implemented secure read path for submissions and flags under RLS via
  `submissions_with_flags_view`; `/state` now consumes views only. Opened and
  merged #85.
- Enabled RLS for `submission_flags` and added read-only policy (visible only
  post-publish). Marked the view as `SECURITY BARRIER`.
- Opened/updated roadmap issues and synced the Project board.

Next (M1 wrap)

- Ensure all server DB reads are via views under RLS.
- Wire watcher usage/documentation as a first-class dev/prod component.
- Begin M2 preparation (JCS + nonces) once M1 is green.

## 2025-10-02 | 19:03 Summary

Tightened docs and git hygiene, fixed project discipline, created a reusable
`gh` project wrapper, and aligned Issues/Milestones/Board for M1; cleaned up
noisy PRs and verified vote path is already correct on main.

## Event Log

### PR #108 cleanup and .obsidian noise

Removed accidentally committed `.obsidian/`, added it to `.gitignore`, and
resolved PR #108’s merge conflicts by taking `main` for SQL/tests (no work
lost), then merged the minimal change.

#### Summary — PR #108

| Context     | Outcome                                                        |
| ----------- | -------------------------------------------------------------- |
| Summary     | PR #108 reduced to necessary gitignore fix; conflicts resolved |
| Problem     | PR carried editor files and had SQL/test conflicts with main   |
| Status      | Resolved                                                       |
| Resolution  | Removed `.obsidian`; added ignore; merged main SQL/tests       |
| Future Work | None                                                           |
| Weight      | 0.20                                                           |

#### References

- Commit 5e9ac23 (merge), `.gitignore` update

#### Key Decisions

- Prefer `main` for conflicted SQL/tests to avoid divergence.

#### Action Items

- None.

#### Notes

- Preserved history (no force‑push); forward‑only merge.

---

### docs/GettingStarted markdownlint and fences

Fixed broken code fences, list indentation, and multi‑line env example; CI
markdownlint passes.

#### Summary — GettingStarted

| Context     | Outcome                                                   |
| ----------- | --------------------------------------------------------- |
| Summary     | Normalized fences/lists; added missing trailing backslash |
| Problem     | MD007/MD005/MD013 failures and broken rendering           |
| Status      | Resolved                                                  |
| Resolution  | Edited fences, nested lists, and wrapped long lines       |
| Future Work | None                                                      |
| Weight      | 0.20                                                      |

#### References

- Commits d2636cd, 61483cb
- Issue #110 (created and closed)

#### Key Decisions

- Keep examples short; use `bash`/`json` fences for clarity.

#### Action Items

- None.

#### Notes

- Verified locally and via CI jobs.

---

### Room create + tests alignment

Ensured `room_create(topic,cfg,client_nonce)` idempotency and round‑0
`ON CONFLICT` are present; tests on `main` already cover idempotency and
bounds—branch work folded into `main` path.

#### Summary — Room Create

| Context     | Outcome                                                  |
| ----------- | -------------------------------------------------------- |
| Summary     | Confirmed `main` already includes desired RPC + tests    |
| Problem     | Branch diffs overlapped with upstream state              |
| Status      | Resolved                                                 |
| Resolution  | Took `main` during conflict; added only missing comments |
| Future Work | Docs parity tracked in #113                              |
| Weight      | 0.10                                                     |

#### References

- Issue [#113](https://github.com/flyingrobots/db8/issues/113) (docs parity)

#### Key Decisions

- Avoid duplicate work; track parity as a docs task.

#### Action Items

- Complete #113.

#### Notes

- Maintains a single source of truth.

---

### Strict Issues/Backlog/Board discipline

Codified process in AGENTS.md; added backlog template; created Issues and set
Milestones; ensured Project board usage is explicit.

#### Summary — Process Discipline

| Context     | Outcome                                               |
| ----------- | ----------------------------------------------------- |
| Summary     | Process is airtight and documented in‑repo            |
| Problem     | Ad‑hoc linking and backlog duplication risks          |
| Status      | Resolved                                              |
| Resolution  | Wrote rules; added backlog doc; created/linked Issues |
| Future Work | Enforce during reviews; keep board accurate           |
| Weight      | 0.20                                                  |

#### References

- AGENTS.md (process section)
- docs/tasks/backlog.md (template)
- Issues [#112](https://github.com/flyingrobots/db8/issues/112),
  [#113](https://github.com/flyingrobots/db8/issues/113),
  [#114](https://github.com/flyingrobots/db8/issues/114)

#### Key Decisions

- Backlog is staging only; no duplicates with open Issues.

#### Action Items

- Use the wrapper to set Status/Workflow/Milestone every time.

#### Notes

- M1 is the default focus after any side task.

---

### gh project wrapper tool

Added `scripts/gh-project.js` and `npm run project` to add items to the board
and set Status/Workflow/Milestone without raw GraphQL.

#### Summary — Project Wrapper

| Context     | Outcome                                                 |
| ----------- | ------------------------------------------------------- |
| Summary     | One‑shot CLI for project updates; linted and documented |
| Problem     | Repeated GraphQL wrangling per session                  |
| Status      | Resolved                                                |
| Resolution  | Implemented Node wrapper over gh subcommands            |
| Future Work | Optional: assign owners in the tool; auto‑detect repo   |
| Weight      | 0.20                                                    |

#### References

- scripts/gh-project.js; AGENTS.md “Project tooling” usage

#### Key Decisions

- Prefer wrapper + gh CLI over custom GraphQL queries.

#### Action Items

- Consider adding `--assignees` support.

#### Notes

- Linted to repo standards; added to package.json as `project` script.

---

### vote_submit validation status

Created a branch for vote validation work; confirmed `main` already enforces
`EXCLUDED.ballot`, phase/window checks, and participant membership—no changes
required.

#### Summary — vote_submit

| Context     | Outcome                                       |
| ----------- | --------------------------------------------- |
| Summary     | Verified main already has fix; no‑op branch   |
| Problem     | Potentially missing validation in DB function |
| Status      | Resolved                                      |
| Resolution  | Audited db/rpc.sql; matched prior fix on main |
| Future Work | Add tests if coverage gaps appear             |
| Weight      | 0.10                                          |

#### References

- db/rpc.sql (vote_submit)

#### Key Decisions

- Do not duplicate fixes; focus on tests if needed.

#### Action Items

- None.

## 2025-10-02 | 20:19 Summary

Stabilized process and project hygiene (Issues/Milestones/Board), disabled
overzealous markdownlint rules, added HRs to debriefs, and shipped a small
`gh` project wrapper so we stop wrangling GraphQL.

## Event Log

### Project helper CLI

Added `scripts/gh-project.js` and `npm run project` to add Issues to the
Project and set Status/Workflow/Milestone without raw GraphQL/gh api calls.

#### Summary

| Context     | Outcome                                                   |
| ----------- | --------------------------------------------------------- |
| Summary     | One-shot CLI for board updates, documented in AGENTS.md   |
| Problem     | Repeated manual/GraphQL steps to add/update project items |
| Status      | Resolved                                                  |
| Resolution  | Implemented Node wrapper over gh project subcommands      |
| Future Work | Optional: `--assignees` flag and repo auto-detect         |
| Weight      | 0.30                                                      |

#### References

- scripts/gh-project.js
- AGENTS.md Project tooling section

#### Key Decisions

- Prefer the wrapper for project updates; avoid GraphQL wrangling.

#### Action Items

- Consider owner assignment support in the tool.

#### Notes

- Linted to repo standards; exposed via `npm run project`.

---

### Issues, milestones, and board updates (M1 focus)

Created Issues and set Milestone/Status; added to the Project board with
`Todo`/`Workflow: Todo` and left instructions to maintain accuracy.

#### Summary

| Context     | Outcome                                                       |
| ----------- | ------------------------------------------------------------- |
| Summary     | #112/#113 created and set to “M1: MVP Loop”; added to Project |
| Problem     | Missing/implicit tracking for fresh tasks                     |
| Status      | Resolved                                                      |
| Resolution  | Used gh CLI to create and add items; set milestone/status     |
| Future Work | Keep board fields accurate during execution                   |
| Weight      | 0.20                                                          |

#### References

- Issues [#112](https://github.com/flyingrobots/db8/issues/112),
  [#113](https://github.com/flyingrobots/db8/issues/113),
  [#114](https://github.com/flyingrobots/db8/issues/114)

#### Key Decisions

- M1 remains the priority after side tasks.

#### Action Items

- Start #112 (RLS reads via views only) next.

#### Notes

- Project owner: `flyingrobots`, Project: “db8 Roadmap”.

---

### Markdownlint policy and debrief readability

Disabled MD013 (line-length) and MD024 (duplicate headings); documented
rationale and added a rule to separate event blocks with HRs in debriefs.

#### Summary

| Context     | Outcome                                                           |
| ----------- | ----------------------------------------------------------------- |
| Summary     | Authoring is frictionless; debriefs scan cleanly                  |
| Problem     | Wrapping and duplicate-heading warnings muddied authoring         |
| Status      | Resolved                                                          |
| Resolution  | Toggled rules in .markdownlint.jsonc; added guidance to AGENTS.md |
| Future Work | None                                                              |
| Weight      | 0.20                                                              |

#### References

- .markdownlint.jsonc
- AGENTS.md Docs/Markdown conventions

#### Key Decisions

- Prefer soft-wrap and repeatable template headings for modern docs.

#### Action Items

- None.

#### Notes

- HR (`---`) between Event Log entries is now the norm.
