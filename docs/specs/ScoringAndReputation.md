---
lastUpdated: 2025-10-02
tags: [spec]
milestone: M5: Scoring & Elo
---

# Scoring & Reputation (M5)

Scope

- Rubric inputs per judge (E/R/C/V/Y) → composite via trimmed mean.
- Movement bonus from stance deltas.
- Reputation updates (Elo) globally and by tag.
- Views and UI for scoreboards and deltas.

Acceptance Criteria

- DB: `scores` (per-judge inputs), `score_aggregates` (materialized or view),
  `reputation`, `reputation_tag` with indexes and pgTAP coverage.
- Worker: deterministic Elo job producing deltas; idempotent by `(room, round)`.
- RPC: write and read endpoints for judge inputs; aggregate reads via views only
  under RLS.
- Server/UI: scoreboards render per-dimension and composite; show movement bonus
  separately.
- Tests: unit tests for Elo math; pgTAP for constraints; Vitest for RPC and
  aggregates.

Data Model (sketch)

- `scores(id, round_id, judge_id, participant_id, e int, r int, c int, v int, y
int, created_at)`
- `reputation(participant_id, elo float, updated_at)`
- `reputation_tag(participant_id, tag text, elo float, updated_at)`

Non-Goals

- Final vote implementation (M4).

Links

- Features.md → Epic: Scoring & Reputation
- UserStories.md → Scoring section

Issues

- #97 feat(db): scoring & reputation schema + pgTAP
- #98 feat(worker): Elo update job (deterministic)
- #99 feat(rpc): judge scoring inputs + aggregates
- #100 feat(web): scoring UI (per-dimension + composite)

---

Implementation Notes

- Keep Elo parameters in a single function (K-factor, floors/caps) and freeze
  them for reproducibility.
