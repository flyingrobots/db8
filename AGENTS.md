---
lastUpdated: 2026-08-16
---

# AGENTS.md

Conventions and checkpoints for coding agents working in this repository.
Applies to every file here.

This file states **how to work**. It is deliberately short. The durable standards
live in their own documents, because a specification buried in an activity log
gets skimmed:

| Standard | Covers |
| --- | --- |
| [Testing Standards](docs/TESTING-STANDARDS.md) | Rule-ID'd (A–K). Governs any change that adds, modifies, or deletes a test, or that fixes a defect. Cite rule IDs in commits and review (e.g. "violates A3"). |
| [Documentation Standards](docs/DOCUMENTATION-STANDARDS.md) | Page types, the corpus map, examples as contract, and what CI may gate on. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Prerequisites, install, running the stack, the test harness, linters, commit rules. |
| [Documentation map](docs/README.md) | Where every durable page lives. |

There is no session-log or debrief archive. Git history is the record: use
`git log`, `git blame`, and the commit messages, which are written to carry the
reasoning. Do not reintroduce a narrative log file — it decays into stale
"current state" claims that outrank the code in a reader's mind.

## Working style

- **JavaScript only** across web, server, and CLI. No TypeScript.
- **Validate at the edges with Zod.** Interior code may assume parsed input.
- **Keep the server and watcher small.** Heavy work belongs in SQL/RPC/RLS or the
  worker.
- **Prefer deterministic behaviour**: stable hashing, canonical JSON, advisory
  locks. A behaviour that depends on wall-clock time, ambient randomness, or row
  order is a defect waiting for a busy day.
- **One implementation of an invariant.** A second copy of a schema, a
  canonicalizer, or a path grammar drifts from the first the moment either
  changes. This has already cost the project a shipped bug.

## Guardrails enforced by repo config

- Node 22+ (`.nvmrc`, `engines`, CI). `npm install` requires the
  `legacy-peer-deps=true` in `.npmrc` — see [CONTRIBUTING.md](CONTRIBUTING.md)
  for why removing it breaks `npm ci`.
- ESLint + Prettier (`eslint.config.js`, `.prettierrc`), markdownlint, cspell.
  All four must pass; hooks in `scripts/hooks/` enforce them.
- CI runs lint and the full suite against a real Postgres, twice: once on a
  fresh database and once over the state the first pass left behind, as an
  idempotency gate.
- Tests run in **randomized order** with a pinned seed (`vitest.config.js`).
  A failure under a particular seed is a real isolation defect. Reproduce it
  with `VITEST_SEED=<seed>`; never retry until green.

## History hygiene

Never amend, rebase, squash, or force-push. Always add new commits and resolve
forward. Branch before committing; `main` is protected by convention.

## Issue and backlog discipline

Source of truth is GitHub Issues plus the "db8 Roadmap" project. The backlog
file is staging only.

- **No PRs without a linked issue**, except trivial changes (docs typos, ignore
  entries of five lines or fewer). For a trivial change, either open a retro
  issue and close it with links, or log it in `docs/tasks/backlog.md`.
- A task exists in **exactly one place** — the backlog or an open issue, never
  both. When promoting a backlog entry to an issue, remove the entry in the same
  commit and reference the new issue number in the commit message.
- Keep board state accurate as it changes: `Todo` when queued, `In Progress`
  when actively coding, label `status/in-review` when a PR opens, `Done` and
  closed via `Fixes #<n>` on merge. Delete the branch after merge.

Use the helper rather than raw GraphQL:

```bash
npm run project -- add --owner flyingrobots --project-title "db8 Roadmap" \
  --issues 112,113 --status "Todo" --workflow "Todo" --milestone "M1: MVP Loop"
```

It requires an authenticated `gh` (`gh auth status`).

## Commits and pull requests

- Conventional Commits, enforced by the commit-msg hook and by CI on the PR
  title. `!` is accepted; a `BREAKING CHANGE:` footer is preferred for anything
  user-visible, and a breaking change should come with a recommended version
  bump.
- PR bodies use Markdown, no HTML: **Summary / Changes / Tests / Next**, plus an
  auto-close reference (`Fixes #<n>`, `Closes #<n>`, or `Partially addresses
  #<n>`). Set labels (`area/*`, `type/*`, `priority/*`) and the milestone.
- **Never open draft pull requests.**
- Branch names: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- Merge method: **Merge** (squash is disabled on this repo). Wait for review;
  let the user merge.

## The loop

1. **Issue hygiene.** Find or create the issue; set Status and Workflow.
2. **Tests first.** If a test exists, run it — a failure means there is work. If
   none exists, write one capturing the invariant, then run it. A passing test
   means the task is done. Follow [the testing
   standards](docs/TESTING-STANDARDS.md); in particular, watch every new
   load-bearing assertion fail once for the right reason (B1).
3. **Implement.** The smallest change that satisfies the test. Iterate to green.
4. **Document.** Update the living page for anything whose behaviour changed,
   per [the documentation standards](docs/DOCUMENTATION-STANDARDS.md). Every
   Markdown file carries `lastUpdated`; spec docs also carry `tags: [spec]` and
   their milestone. No `title` in frontmatter — the first body line is a single
   H1.
5. **Ship.** Update the issue, open the PR, and update `CHANGELOG.md` for
   anything release-visible.

## Reporting

Two habits matter more than they look:

- **Do not claim a file was updated without re-reading it.** Scripted edits that
  matched no anchor have silently no-opped here while the commit message claimed
  the change landed. Assert the anchor before writing; verify after.
- **Report outcomes faithfully.** A skipped step, a known flake, or a partial
  fix is information. Suppressing it converts a small problem into a surprise.
