# Features

This document outlines the feature set for db8, grouped by epics and slices you can ship incrementally. It mirrors the architecture in docs/Architecture.md and stays technology-agnostic where possible.

## Milestones

M0 — Repo + Docs

- Public repo, license, .gitignore, architecture and feature docs.

M1 — Room Skeleton (deterministic loop)

- Create room, seed participants (anon_1..anon_5), open Round 0.
- Submit window with barrier; private drafts; atomic publish reveal.
- Verify stub (accept-all) to make barrier flip deterministic.
- Web auth (Supabase) for humans; JWT on requests.
- CLI auth (room-scoped JWT) and basic submit flow.
- Idempotency: `client_nonce` on submissions; unique (round_id, author_id, client_nonce).
- Backpressure: simple rate limits per (room_id, participant).
- Authoritative timers via a small Watcher that broadcasts `ends_unix`.
- GET `/state?room_id` for reconnect replay of authoritative state.
- Zod-validated RPCs; Postgres schema; reads via RLS views; writes via service-role RPC with checks.
- Realtime updates (round phase, submissions, timers) via Supabase Realtime.
- Pre-publish stubs: FORFEIT/REJECTED render as stub cards with reasons.
- Minimal admin: create room, open next round, force publish (logged to journal).
- Journals: write a per-round journal manifest on publish.

M2 — Provenance & Journaling

- Canonical JSON hashing (sha256) for every submission (already in M1).
- Optional client signatures (SSH or Ed25519) for CLI/agents; server verifies and stores detached sigs.
- Server round checkpoint hash, signed with server key (minisign/KMS), journaled to ShipLog refs per round.
- Allowed signers from SSH CA; challenge/verify endpoints for agents.
- Presence (cosmetic) via Supabase Realtime.
- Research cache with quotas (per round): `max_unique_domains`, `max_fetches`.
- Downloadable journal and CLI verify.

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
- Challenge/response endpoint for agents using `ssh-keygen -Y sign/verify` (land in M2).

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
- Timer broadcaster (WS) on state changes (authoritative Watcher).

### Epic: Submissions & Provenance

- Draft edit UI (private); submit within deadline; resubmit bumps version.
- Canonical JSON build + sha256.
- Optional client signature capture: `signature_kind`, `signature_b64`, `signer_fingerprint`.
- Server verify (SSH/Ed25519) and store results.

Slices

- Zod schemas for payloads; canonicalization util; `dry_run=true` path.
- RPC `submission_upsert(...)` with versioning, idempotency (`client_nonce`), and RLS-guarded reads.
- SSH verify helper (exec `ssh-keygen -Y verify`) or libsodium verify for Ed25519.
- Store canonical_sha256 and signature fields on row.

### Epic: Realtime & Presence

- One Supabase Realtime channel per room.
- DB-backed changefeeds via secure views (rounds_view, submissions_view, votes_view).
- Broadcast-only timers from server for countdowns.
- Presence for “who’s here” (from M2).

Slices

- Views + RLS to expose exactly what each role can see over time.
- Frontend subscriptions with Zod-validated events.
- SSE fallback for CLI.

### Epic: Verification & Moderation

- Verify phase dashboard for fact-checkers/moderators.
- Mark supported/unsupported claims; rejected reasons on submission.
- Minimal workflow to move all to verified/forfeit before publish.
- Accept-all verify stub in M1; automated checks later.
- Publish stubs for FORFEIT/REJECTED with reasons.

Slices

- Fact-checker UI components and RPC.
- Rejected reasons JSON and status transitions.

### Epic: Voting

- Continue vote window per published round.
- Final vote with approval + optional ranked tie-break.
- Tally and result publish.

Slices

- Votes table + RLS.
- RPC `vote_submit(round, voter, kind, ballot)`.
- Aggregates for continue pass/fail and final placements.
- Simple majority of cast ballots; soft quorum (≥3 votes) to avoid zombie rounds.

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

- Journal writer after each publish (per-round).
- Verification CLI command.

### Epic: Research Tools

- Research cache with dedup by URL hash and domain metadata.
- Snippet previews; citation builder in editor.

Slices

- `research_cache` table and basic fetcher.
- UI to insert citations and validate 2+ citations rule.
- Quotas/counters to prevent abuse (per room/round caps).

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

### Epic: CLI (db8)

- Global configuration and session handling (config.json, session.json).
- Auth: device-code/magic-link login; whoami.
- Room: status (snapshot) and watch (WS/SSE).
- Draft: open (template), validate (Zod with canonical SHA), submit/resubmit (idempotent nonce).
- Optional provenance: SSH signing of canonical JSON + detached sig attach.
- Voting: continue; final (approval + optional ranking).
- Journals: pull and verify.
- Agent QoL: run script to watch and submit.

Slices

- CLI skeleton entry (bin/db8.js), command router, flags, error codes.
- Config/session management with env var overrides.
- Canonicalizer + Zod schemas (shared package later).
- Submit flow with nonce and JSON output; resubmit convenience.
- Watch with JSON line events.
- SSH signing adapter (behind --sign).
- Journal pull/verify commands.

## Non-Functional Requirements (NFRs)

Security

- JWT verification on all RPC; RLS as primary isolation.
- SSH/Ed25519 signature verification for agents; short-lived certs to avoid revocation.
- Anti-replay fields in signed payloads, small clock skew allowed.
- Basic abuse controls (profanity filter) at submission entry.

Performance

- Room N≈5–10 participants; events < 100/s typical.
- Changefeed via views; avoid over-subscribing tables directly.
- Timer broadcasts every 1s max per active room.

Reliability

- Advisory locks for atomic phase flips.
- Idempotent RPCs with `client_nonce` to avoid duplicates.
- Journals are append-only; verify locally from public refs.
- `/state?room_id` endpoint for reconnect replay.

Compliance/Privacy

- Store only necessary identity in participants mapping.
- Do not store raw private keys; fingerprints only.
- Respect Supabase region and data residency settings.
- Audit log of moderator overrides in the journal.
