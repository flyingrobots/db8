# AGENTS.md

This file gives the coding agent (you) conventions and checkpoints for working in this repo.

Scope
- Applies to all files in this repository.
- Keep changes small and focused; follow the guardrails below.

Progress tracking
- Primary tracker: GitHub Project “db8 Roadmap”.
- Use labels and milestones already created (area/*, type/*, priority/*, M1–M7).
- When you open PRs, link the corresponding issues and set the milestone.

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
1) Write/adjust pgTAP invariants for rooms/rounds/submissions.
2) Write minimal Vitest tests for canonical JSON and RPC schema validation.
3) Keep E2E smoke as a placeholder (skip) until routes exist.

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

