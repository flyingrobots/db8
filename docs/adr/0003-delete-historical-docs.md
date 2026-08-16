---
lastUpdated: 2026-08-16
---

# ADR-0003: Delete stale documentation rather than archive it

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** James Ross

## Context

`AGENTS.md` had reached 1429 lines. Roughly 350 of those were the testing
standards; the rest was accumulated sediment — session logs from September and
October 2025, milestone status, merged-PR debriefs, a "Next Moves (Plan)"
section, and a Neo4j integration block pointing at a local service with a
hardcoded password.

The problem was not size. It was that the sediment was written in the **present
tense**. Sections asserted "M1 is the primary focus", listed "Endpoints delivered
(M1)", and described a working style that had since changed. A reader — human or
agent — has no way to tell which paragraph is current policy and which is a
snapshot of a Tuesday ten months ago. Stale documentation does not sit inertly
next to the truth; it competes with it, and it wins whenever the reader trusts
prose over code.

The same pattern existed across `docs/`: an original pitch document, a completed
feedback checklist, a one-time backlog resequencing plan, a milestone journal, a
PR debrief in JSONL, and an early orientation piece.

The obvious move is to archive: move it under `docs/logs/`, add a "Historical"
banner, keep it for provenance. That was in fact the first thing done — banners
were added and files were relocated.

## Decision

**Delete it. Git history is the archive.**

Stale pages are removed outright rather than relocated behind a banner. When a
page stops being true it is fixed or deleted; there is no third option and no
archive directory.

The one exception is `docs/feature-proposals/`, which records proposal-era
reasoning — _why_ a change was accepted or rejected. Those pages must say
explicitly that they are not current behaviour.

## Consequences

**Better.** Every page under `docs/` describes `main`. There is no category of
document a reader must first classify before trusting. The corpus shrank from 24
Markdown files to 17, and `AGENTS.md` from 1429 lines to 121 — which makes the
standards it links to considerably more likely to be read.

**Worse.** Finding old context now requires `git log`, `git show`, or
`git log --diff-filter=D --name-only` to locate a deleted path. That is a real
cost for anyone who does not think of git as a document store. It is mitigated
by commit messages carrying the reasoning, which is a discipline this repository
already had.

**Now load-bearing.** Commit messages. If they degrade into "update docs", the
archive becomes unreadable and this decision becomes a mistake in hindsight.

**Must stay true.** That nothing is deleted _before_ it is committed. This is
only safe because every removed file existed in history first; deleting an
untracked draft loses it for good.

**A banner is not a substitute.** The rejected middle path — keep it, mark it
historical — was tried and abandoned in the same session. A banner asks every
future reader to do the classifying work, forever, and a reader who skims misses
it entirely.

## Alternatives considered

**Archive under `docs/logs/` with historical banners.** Implemented, then
reverted within the same session. It preserves the text at the cost of leaving
stale prose in the search path — the exact failure mode being fixed.

**Move to a separate branch or an `archive/` tag.** Rejected as ceremony: it is
what git already does, with extra steps and a thing to forget.

**Keep the agent log, trim it periodically.** Rejected. It had already grown to
780 lines without anyone trimming it, which is the evidence.

## References

- `docs/DOCUMENTATION-STANDARDS.md` §2 — "Every page in `docs/` describes `main`"
- `AGENTS.md` — "There is no session-log or debrief archive. Git history is the record."
- Commit `7c40a75` — the split and the deletions
