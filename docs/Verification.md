---
lastUpdated: 2025-10-08
---

# Verification

This milestone (M3) adds per-claim and per-submission verification verdicts. Judges (and hosts) can submit verdicts like true, false, unclear, or needs_work for a submission or a specific claim within it. A read-only summary surfaces aggregates in the UI and via CLI.

## What’s Included

- Postgres table `verification_verdicts` with idempotency on `(round_id, reporter_id, submission_id, coalesce(claim_id,''))`.
- RLS enabled; reads are allowed after publish/final or always for the reporting participant. Writes occur via the `verify_submit` RPC (SECURITY DEFINER) and enforce room membership and judge/host role.
- RPCs:
  - `verify_submit(round_id, reporter_id, submission_id, claim_id, verdict, rationale, client_nonce) → uuid`
  - `verify_summary(round_id) → rows (per-claim/per-submission tallies)`
- Server endpoints:
  - `POST /rpc/verify.submit` — DB first, in-memory fallback
  - `GET /verify/summary?round_id=…`
- CLI:
  - `db8 verify submit --round <uuid> --submission <uuid> [--claim <id>] --verdict <true|false|unclear|needs_work> [--rationale <text>] [--nonce <id>]`
  - `db8 verify summary --round <uuid>`
- Web: Room page displays a small “Verification Summary” list.

## Usage

- As a judge/host, submit a verdict:

  db8 verify submit --round <round-uuid> --submission <submission-uuid> --verdict true

- Inspect aggregates for a round:

  db8 verify summary --round <round-uuid>

## Notes

- The server prefers the DB path. If Postgres is not configured, an in-memory fallback supports demos/tests (non-persistent).
- RLS visibility mirrors submissions: verdicts become generally visible after the round is published; reporters always see their own.
