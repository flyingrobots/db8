---
id: FP-20250928-fact-checking-quorum
status: Draft
authors: James Ross <james@flyingrobots.dev>
date: 2025-09-28
related-issues: []
---

# Quorum-Based Fact-Checking With Confidence Heuristic

## Problem Statement

The current fact-checking path records a single verdict per submission. A lone checker—human or system—introduces bias risk, yields no measure of disagreement, and limits downstream analysis. Researchers need richer provenance that exposes inter-model dissent and provides a quantifiable trust signal for each claim.

## Goals

- Capture multiple fact-check verdicts per submission using a quorum of diverse agents.
- Publish an easy-to-consume confidence score derived from quorum agreement.
- Preserve per-checker provenance so researchers can audit bias and disagreements.

## Non-Goals

- Redesigning the entire verification workflow or introducing realtime UI changes.
- Guaranteeing perfect fact accuracy—the goal is better signalling, not certainty.
- Replacing existing confidence_score semantics for individual checkers.

## Proposed Solution

- Treat `FACT_CHECK_VERDICTS` as a per-checker table: one row per agent in the quorum. `verdict_classification` becomes boolean / +/-1.
- Define cohorts of system agents (or humans) to act as quorum members (minimum 3, ideally 5). Each checker uses a distinct configuration.
- Compute a normalized confidence heuristic: `(sum(verdict_i) + N) / (2N)` where verdict_i = +/-1.
- Store the computed value in a public view (e.g., extend `ROUND_SUMMARY_V`) to ship with research datasets.
- Retain the existing `confidence_score` column for the checker’s self-reported confidence; the quorum heuristic is separate.

## Alternatives Considered

- Weighted averages per checker – rejected due to tuning complexity and lack of neutrality.
- Majority-only boolean – rejected because it discards useful magnitude information.

## Risks & Mitigations

- **Checker drift / bias**: diversify quorum members and log metadata for analysis.
- **Performance overhead**: batch the heuristic calculation when all quorum responses arrive; ensure round summary view is indexed.
- **Data explosion**: manageable since quorum size is small; enforce limits in schema or application layer.

## Open Questions

- How are quorum memberships configured and rotated? Static per room vs dynamic?
- Do we block publish until all quorum members respond or allow partial confidence with timers?
- Should the heuristic exclude self-evaluations when the checker also authored the submission?

## Implementation Notes (filled in after acceptance)

- Tracking issue:
- Related PRs:
- Release notes / deployment considerations:
- Deviations from proposal:
