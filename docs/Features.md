# Features

This document outlines the feature set for db8, grouped by epics and slices you can ship incrementally. It mirrors the architecture in docs/Architecture.md and stays technology-agnostic where possible.

## Milestones

M0 — Repo + Docs
- Public repo, license, .gitignore, architecture and feature docs.

M1 — Room Skeleton (MVP debate loop, no scoring)
- Create room, seed participants (anon_1..anon_5), open Round 0.
- Submit window with barrier; private drafts; atomic publish reveal.
- Web auth (Supabase) for humans; JWT on requests.
- CLI auth (room-scoped JWT) and basic submit flow.
- Zod-validated RPCs; Postgres schema; RLS to isolate private submissions pre-publish.
- Realtime updates (round phase, submissions, timers) via Supabase Realtime.
- Minimal admin: create room, open next round, force publish.

M2 — Provenance & Journaling
- Canonical JSON hashing (sha256) for every submission.
- Optional client signatures (SSH or Ed25519) for CLI/agents; server verifies and stores detached sigs.
- Server round checkpoint hash, signed with server key (KMS/minisign), journaled to Shiplog refs.
- Downloadable journal to verify locally (public verifiability).

M3 — Fact-Checking & Verify Phase
- Fact-check worker stubs; mark submissions verified/rejected with reasons.
- UI affordances to show verification status before publish.
- Realtime verify status changes.

M4 — Votes, Continue/Final, and Publish Flow
- Continue vote window after each published round (strict majority to continue).
- Final vote (approval + ranked tie-break) at the end of the debate.
- Post-publish transcript view with all submissions for the round.

M5 — Scoring & Reputation
- Rubric scoring (E/R/C/V/Y) with weights and trimmed-mean aggregation.
- Movement bonus from voter stance deltas.
- Concession logging and effects on scores.
- Elo updates (global and by topic tag); calibration (Brier) tracking.

M6 — Research Tools & Cache
- Shared research cache with URL de-duplication and snapshots.
- In-UI helpers to cite sources and show snippets.

M7 — Hardening & Ops
- Rate limits, DLQ for failed submissions, advisory locks.
- SSH CA management, cert issuance endpoint, allowed_signers generation.
- Observability (structured logs), backups for journals, privacy review.

---

## Epics and Feature Slices

### Epic: Identity & Authorization
- Supabase Auth for web (magic links/passkeys).
- JWT middleware on server; pass `jwt_sub` to RPC or rely on auth.jwt() in Supabase.
- Participants mapping: (room_id, anon_name) with optional `jwt_sub` and `ssh_fingerprint`.
- CLI/Agents: SSH Ed25519 key support; optional short-lived SSH certs via CA.
- Challenge/response endpoint for agents using `ssh-keygen -Y sign/verify` (optional in MVP; needed by M2).

Slices
- Web login + session handling.
- Participant claim/bind: map `jwt_sub` to a participant slot in a room.
- CLI login: obtain room-scoped JWT, store session file.
- (Later) SSH cert issuance + verify with `allowed_signers` set.

### Epic: Rooms, Rounds, and Barriers
- Room lifecycle: create → active → closed.
- Round lifecycle: research → submit → verify → published → (continue?) → final → results.
- Deadlines and timers with authoritative server broadcasts.
- Advisory lock to flip phases atomically per room.

Slices
- RPC `room_create(topic, cfg)` seeds participants and opens Round 0.
- Round state machine: `round_publish_due()`; `round_open_next()`.
- Timer broadcaster (WS) on state changes.

### Epic: Submissions & Provenance
- Draft edit UI (private); submit within deadline; resubmit bumps version.
- Canonical JSON build + sha256.
- Optional client signature capture: `signature_kind`, `signature_b64`, `signer_fingerprint`.
- Server verify (SSH/Ed25519) and store results.

Slices
- Zod schemas for payloads; canonicalization util.
- RPC `submission_upsert(...)` with versioning and RLS guards.
- SSH verify helper (exec `ssh-keygen -Y verify`) or libsodium verify for Ed25519.
- Store canonical_sha256 and signature fields on row.

### Epic: Realtime & Presence
- One Supabase Realtime channel per room.
- DB-backed changefeeds via secure views (rounds_view, submissions_view, votes_view).
- Broadcast-only timers from server for countdowns.
- Presence for “who’s here”.

Slices
- Views + RLS to expose exactly what each role can see over time.
- Frontend subscriptions with Zod-validated events.
- SSE fallback for CLI.

### Epic: Verification & Moderation
- Verify phase dashboard for fact-checkers/moderators.
- Mark supported/unsupported claims; rejected reasons on submission.
- Minimal workflow to move all to verified/forfeit before publish.

Slices
- Fact-checker UI components and RPC.
- Rejected reasons JSON and status transitions.

### Epic: Voting
- Continue vote window per published round.
- Final vote with approval + optional ranked tie-break.
- Tally and result publish.

Slices
- Votes table + RLS.
- RPC `vote_submit(room, round, voter, kind, ballot)`.
- Aggregates for continue pass/fail and final placements.

### Epic: Scoring & Reputation
- Rubric scoring inputs (human/auto) → composite.
- Movement bonus from stance deltas.
- Concession logging.
- Elo updates (global + by tag), calibration tracking.

Slices
- `scores`, `claim_checks`, `reputation`, `reputation_tag` tables.
- Elo update SQL or worker.
- Stats view for “Stats & Reveal”.

### Epic: Journaling & Provenance Publishing
- Shiplog refs `_db8/journal/<room>/round-*` with payloads, sigs, and chain signatures.
- Server KMS/minisign key; publish public key.
- CLI command to verify journals locally.

Slices
- Journal writer after publish.
- Verification CLI command.

### Epic: Research Tools
- Research cache with dedup by URL hash and domain metadata.
- Snippet previews; citation builder in editor.

Slices
- `research_cache` table and basic fetcher.
- UI to insert citations and validate 2+ citations rule.

### Epic: DX, Ops, and Security
- Rate limiting per (room_id, participant).
- DLQ via pgmq for failed writes/late submissions.
- SSH CA management UX and rotation.
- Structured logging; metrics (timers, counts, errors).

Slices
- Middleware for rate limits.
- Watcher process for round flips and cleanup.
- Backups for journals; retention policy.

---

## Non-Functional Requirements (NFRs)

Security
- JWT verification on all RPC; RLS as primary isolation.
- SSH/Ed25519 signature verification for agents; short-lived certs to avoid revocation.
- Anti-replay fields in signed payloads, small clock skew allowed.

Performance
- Room N≈5–10 participants; events < 100/s typical.
- Changefeed via views; avoid over-subscribing tables directly.
- Timer broadcasts every 1s max per active room.

Reliability
- Advisory locks for atomic phase flips.
- Idempotent RPCs with `client_nonce` to avoid duplicates.
- Journals are append-only; verify locally from public refs.

Compliance/Privacy
- Store only necessary identity in participants mapping.
- Do not store raw private keys; fingerprints only.
- Respect Supabase region and data residency settings.

