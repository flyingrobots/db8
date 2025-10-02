---
lastUpdated: 2025-10-02
---

# User Stories

This document captures roles, user stories, and acceptance criteria. Each story
is scoped to be testable and maps to features in `docs/Features.md`.

## Roles

- Guest: unauthenticated visitor (read-only public rooms and transcripts).
- Human User: authenticated via Supabase Auth; can join rooms and participate if
  assigned.
- Participant (Debater): mapped to a room participant slot (anon_1..anon_5).
- Moderator: manages phases, resolves issues, can force publish.
- Fact-Checker: verifies submissions and attaches reasons for rejections.
- Judge: assigns rubric scores per participant.
- Voter: casts continue and final votes.
- Agent/CLI: non-human client using SSH/Ed25519 provenance.
- Admin/Owner: creates rooms, manages CA keys, operational tasks.

---

## Onboarding & Identity

Story: Sign in (web)

- As a human user, I can sign in via magic link or passkey so that I get a JWT
  session for db8.
- Acceptance:
  - Login succeeds; I receive a valid session.
  - My profile is visible in the UI; logout works.

Story: Claim participant slot

- As a human user, I can join a room and claim an available participant slot
  (anon_N) assigned by the moderator or via self-serve flow.
- Acceptance:
  - I see available slots for the room.
  - After claiming, I am mapped (`participants.jwt_sub = my sub`).
  - I can submit only for my slot.

Story: CLI login

- As an agent or CLI user, I can obtain a room-scoped JWT and store it in
  `~/.db8/session.json` so I can call RPCs.
- Acceptance:
  - CLI command `db8 login` exchanges a token and stores the session.
  - Subsequent CLI RPC calls include `Authorization: Bearer`.

Story: SSH provenance setup (later)

- As an agent user, I can use my SSH key (and optional short-lived cert) to sign
  submission payloads so the server can verify provenance.
- Acceptance:
  - `ssh-keygen -Y sign` produces a detached signature.
  - Server verifies the signature and stores `signature_kind`, `signature_b64`,
    and `signer_fingerprint`.

---

## Rooms & Rounds

Story: Create room

- As an admin, I can create a room with a topic so that a new debate can begin.
- Acceptance:
  - RPC `room_create(topic, cfg)` returns a `room_id`.
  - Participants `anon_1..anon_5` are seeded.
  - Round 0 opens in `submit` with a deadline.

Story: View room state

- As any room member, I can see current phase, timers, and participants so I
  know what to do.
- Acceptance:
  - UI shows phase and countdown.
  - Presence shows who’s here (best effort).

Story: Advance phase automatically

- As the system, I flip `submit → verify → published` when conditions are met.
- Acceptance:
  - When the submit deadline passes, round moves to `verify`.
  - When all submissions are verified or forfeit, round moves to `published`
    atomically.
  - Timer broadcasts update on phase changes.

Story: Moderator override

- As a moderator, I can force publish a round or open the next round if needed.
- Acceptance:
  - Moderator-only actions are guarded by RLS and roles.
  - Overrides are logged and visible in the audit trail.

---

## Submissions & Drafting

Story: Draft privately

- As a participant, I can edit a private draft during `submit` phase so others
  can’t see it until publish.
- Acceptance:
  - Draft autosaves locally; server only stores on submit.
  - Before publish, only the author can read the submission row.

Story: Submit before deadline

- As a participant, I can submit my entry before the deadline so it is included
  in the round.
- Acceptance:
  - RPC `submission_upsert` validates with Zod.
  - If re-submitted, version increments and timestamp updates.
  - `canonical_sha256` is returned in the response.

Story: Attach citations

- As a participant, I must include at least two citations and structured claims
  so my submission meets minimum evidence requirements.
- Acceptance:
  - Zod rejects payloads with fewer than two citations or invalid Claim shapes.
  - UI clearly indicates missing requirements.

Story: CLI submit with signature (agent)

- As an agent, I can canonicalize the payload, SSH-sign it, and POST it so the
  server stores and verifies provenance.
- Acceptance:
  - Server verifies detached signatures against allowed signers and room
    mapping.
  - Stored row has `signature_kind='ssh'` and `signer_fingerprint`.

---

## Verification & Publish

Story: Fact-check verify

- As a fact-checker, I can mark a submission as verified or rejected with
  reasons so only valid content gets published.
- Acceptance:
  - Verify UI shows claims and citations.
  - RPC stores `status='verified'|'rejected'` and `rejected_reasons`.
  - Round moves to `published` only when all are verified or forfeit.

Story: Atomic reveal

- As any user, when a round is published, I see all submissions at once so no
  one can copy others before reveal.
- Acceptance:
  - `published_at` set under advisory lock; realtime event emitted.
  - Transcript view renders all submissions for the round.

Story: Attribution control (masked identities)

- As a researcher, I can configure whether author identities are revealed or
  masked at publish so I can run blind or double-blind studies without identity
  bias.
- Acceptance:
  - Room config supports an attribution mode.
  - `/state` and UI reflect masked author labels when enabled.
  - Moderators can set or view the mode; default documented.

---

## Voting

Story: Continue vote

- As a voter, I can cast a continue or end vote after a round so the debate can
  proceed or finish.
- Acceptance:
  - Vote window opens after publish; one vote per participant.
  - Tally decides to open the next round or move to final.

Story: Final vote

- As a voter, I can cast an approval vote and ranked tie break so winners can be
  determined.
- Acceptance:
  - Approval set and optional ranking submitted and stored once.
  - Results computed deterministically; ties resolved by ranking if present.

---

## Scoring & Reputation

Story: Judge rubric scoring

- As a judge, I can score participants on
  Evidence/Responsiveness/Clarity/Civility/Economy so we can compute composite
  scores.
- Acceptance:
  - Per-judge inputs stored; composite via trimmed mean.
  - Scoreboard shows per-dimension and aggregate.

Story: Movement bonus

- As the system, I compute stance movement from voters to reward persuasion.
- Acceptance:
  - Movement per participant computed from start→end stance deltas.
  - Bonus added to final score with visible breakdown.

Story: Update Elo

- As the system, I update per-participant Elo (global and by tag) after results
  so reputation evolves with performance.
- Acceptance:
  - Elo deltas logged; per-opponent pairwise updates applied; caps honored.
  - Reputation view shows current ratings and change.

Story: Calibration tracking

- As the system, I record claim confidence and outcomes so calibration can be
  measured.
- Acceptance:
  - Brier scores computed and averaged per participant.
  - Calibration badge appears for well-calibrated users.

---

## Realtime & Journaling

Story: Live updates

- As a participant, I see live timers, submissions, and phase changes so I can
  act in sync with the room.
- Acceptance:
  - Realtime channel per room; reconnect logic; state resync on reconnect.
  - Timers are authoritative from the server.

Story: Publish a journal

- As an admin, I can publish a signed journal of a round so anyone can verify
  the transcript.
- Acceptance:
  - Chain hash and server signature exist for each round.
  - CLI verify command validates the journal against the public key.

---

## Admin & Ops

Story: Rate limiting

- As the system, I rate limit submission and vote RPCs to protect stability.
- Acceptance:
  - Exceeding rates returns a clear error; logs record spikes.

Story: SSH CA management

- As an admin, I can rotate the SSH CA and publish the new public key in the
  trust ref so agents can continue to authenticate.
- Acceptance:
  - New CA takes effect for newly issued certs; old certs expire naturally.
  - Allowed signers reflect CA/pubkey changes.

Story: Backups and retention

- As an admin, I can back up journals and DB snapshots so debates remain
  auditable.
- Acceptance:
  - Scheduled backups stored; retention policies enforced.

Story: Orchestrator heartbeat and recovery

- As an operator, I want the system to recover cleanly from a crashed
  orchestrator during a barrier period so experiments never get stuck in
  undefined states.
- Acceptance:
  - Heartbeat freshness detected; recovery either publishes or fails the round
    explicitly per spec.
  - Recovery writes audit events; watcher resumes normal operation.

---

## Guest & Read-Only

Story: View published transcript

- As a guest, I can read the published rounds transcript so I can follow the
  debate without an account.
- Acceptance:
  - Only published content is visible; private drafts are never exposed.
  - Provenance badges indicate whether a submission had client signatures.

---

## Nice-to-Haves (Later)

- Browser-side Ed25519 keys for power users; JOSE/minisign signatures.
- Rich research integrations (Wayback, Crossref, YouTube chapters).
- Editor features: templates, claim graph visualizations.
- Webhooks for room and round events (integrations).
- Multi-room dashboards and search.

## CLI

Story: CLI login

- As a CLI user, I can log in via device code or magic link to obtain a
  room-scoped JWT stored in `~/.db8/session.json`.
- Acceptance:
  - `db8 login` writes session with `room_id`, `participant_id`, `expires_at`.
  - `db8 whoami` prints identity and token expiry.

Story: Draft open and validate

- As a CLI user, I can open a draft template and validate it with Zod, seeing
  the canonical SHA256 that matches the server.
- Acceptance:
  - `db8 draft open` creates `./db8/round-<idx>/<anon>/draft.json`.
  - `db8 draft validate` prints the canonical SHA.

Story: Submit and resubmit

- As a CLI user, I can submit with a generated `client_nonce` (or provided via
  `--nonce`) and resubmit with a new nonce to bump version server-side.
- Acceptance:
  - Idempotent submit returns the same `submission_id` for the same nonce.
  - JSON output includes `{ submission_id, canonical_sha256 }` when `--json`.

Story: Watch room

- As a CLI user, I can tail timers and phase changes via WS or SSE, optionally
  as JSON lines for automation.
- Acceptance:
  - `db8 room watch --json` streams events; reconnect is optional (later).

Story: Provenance (opt-in)

- As an agent user, I can sign canonical JSON with SSH and attach the detached
  signature to the submission.
- Acceptance:
  - `db8 submit --sign` finds `DB8_SSH_KEY`, produces a signature, and attaches
    it.
  - Failures produce exit code 6; success stores signature fields.

Story: Journals

- As a user, I can pull and verify journals for a round.
- Acceptance:
  - `db8 journal pull` downloads manifest and files.
  - `db8 journal verify` verifies the chain and signatures.
