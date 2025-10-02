# Voting & Publish Flow (M4)

Scope

- Continue vote window per published round.
- Final vote (approval + optional ranked tie-break).
- Deterministic tally and publish of results.
- Realtime signals for vote window and tally deltas.

Acceptance Criteria

- DB: `final_votes` table with RLS; unique `(round_id, voter_id)`; indexes on
  `(round_id)`.
- Views: `view_final_tally`, `view_continue_tally` (existing) expose minimal,
  role-safe aggregates.
- RPC: `vote_final_submit(round_id, voter_id, approval, ranking_json)` validates
  inputs and enforces one vote per voter.
- Server: SSE emits `event: vote` with `{ kind: 'continue' | 'final', tally }`
  updates; window open and close signals are derived from DB deadlines.
- Web: UI for continue and final votes; disable or respect window timing;
  optimistic UX guarded by server truth.
- Tests: pgTAP for constraints and RLS; Vitest for RPCs, SSE events, and UI
  flows.

Data Model (sketch)

- `final_votes(id uuid pk, round_id uuid fk, voter_id uuid fk, approval boolean
not null, ranking jsonb null, created_at timestamptz)`
- RLS: voters can insert their own vote; read aggregate views only.

Non-Goals

- Scoring aggregation (handled in M5).

Links

- Features.md → Epic: Voting
- UserStories.md → Voting stories

Issues

- #93 feat(db): final vote schema + RLS + views
- #94 feat(rpc): vote.final submit + results publish
- #95 feat(server): SSE signals for vote windows and tallies
- #96 feat(web): final vote UI and results view

---

Implementation Notes

- Keep consistent with `vote.continue` RPC patterns (nonce, idempotency not
  required for final).
- Use `SECURITY DEFINER` RPC with explicit checks when needed; otherwise prefer
  RLS-guarded plain inserts.
