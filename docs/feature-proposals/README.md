# Feature Proposal Process

This directory captures feature proposals (FPs) and their lifecycle. Every
feature starts as a Markdown document using the template below. Proposals move
through three states:

1. `drafts/` – Initial ideas under discussion.
1. `accepted/` – Approved proposals awaiting or undergoing implementation.
1. `rejected/` – Proposals considered but not pursued (kept for reference).

## Authoring a Proposal

Create a new document in `docs/feature-proposals/drafts/` named
`FP-YYYYMMDD-short-title.md` with the template below.

````markdown
---
id: FP-YYYYMMDD-short-title
status: Draft # Draft → Review → Accepted | Rejected
authors: Name <email>
date: 2025-09-28
related-issues: []
---

# Title

## Problem Statement

Describe the research, infra, or product problem. Include evidence, user stories
, or supporting data.

## Goals

List what success means. Be specific.

## Non-Goals

Clarify what is intentionally out of scope.

## Proposed Solution

Outline the design. Cover data model changes, APIs/CLI, operational concerns,
rollout considerations, and testing strategies.

## Alternatives Considered

Document other approaches and why they’re not chosen.

## Risks & Mitigations

Identify failure modes and mitigation strategies.

## Open Questions

Outstanding items that need resolution before acceptance.

## Implementation Notes (filled in after acceptance)

- Issue tracking
- Merged PRs
- Release / deployment notes

```text

## Lifecycle

1. Author writes the FP in `drafts/` and opens a PR titled `fp: <short title>`.
1. During review, discussion happens directly in the PR or within the doc (using
   `NOTE:` blocks).
1. When maintainers approve, update `status: Accepted` (or `Rejected`) in the
   front matter, move the file to `accepted/` (or `rejected/`), and merge the
   PR.
1. Create or link the tracking issue in the proposal document.
1. Implementation PRs reference the FP ID (e.g., `Implements:
   FP-20250928-room-watch-reconnect`).
1. After merge, append details in the **Implementation Notes** section with
   issue/PR links and any deviations.

## Empty State

Each folder contains a `.gitkeep` so the structure stays in git even if no
proposals exist yet.
```
````
