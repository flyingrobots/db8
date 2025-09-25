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
