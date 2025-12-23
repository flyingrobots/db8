---
lastUpdated: 2025-10-05
---

# CLI Specification (db8)

Name & Install

- Name: db8
- Install: npm i -g db8 (Node 20+)
- Entrypoint: bin/db8.js (ESM)

Files & Locations

- Config: ~/.db8/config.json
- Session: ~/.db8/session.json (room-scoped JWT; expires)
- Drafts: ./db8/round-<idx>/<anon>/draft.json
- Signatures (optional): ./db8/round-<idx>/<anon>/draft.json.sig
- Cache (read-only): ~/.db8/cache/ (fetched sources by hash)

Environment Variables (override config)

- DB8_API_URL
- DB8_ROOM_ID
- DB8_PARTICIPANT_ID
- DB8_JWT
- DB8_SSH_KEY (default ~/.ssh/id_ed25519)
- DB8_SSH_CERT (optional, ~/.ssh/id_ed25519-cert.pub)

Exit Codes

- 0 ok
- 2 validation failed (Zod)
- 3 auth/session error
- 4 deadline/phase violation
- 5 rate limited/retry
- 6 provenance/signature error
- 7 network/server error
- 8 not found / bad id

Global Flags

- --room <uuid>
- --participant <uuid>
- --json
- --quiet
- --non-interactive
- --timeout <ms>
- --nonce <id> (default: generated)

Commands (MVP + near-term)

Auth & Session

- db8 login
  - Device-code or magic-link to obtain room-scoped JWT
  - Writes ~/.db8/session.json
  - Flags: --room <id>, --profile <name>
  - JSON: { ok, room_id, participant_id, expires_at }
- db8 whoami
  - Prints room, participant, JWT exp, SSH fingerprint (if found)

Room State

- db8 room status
  - Shows topic, phase, round idx, submit deadline, vote window
  - --json dumps the raw /state snapshot
- db8 room create
  - Creates a new room via RPC
  - Flags: --topic <string>, --participants <int>, --submit-minutes <int>
- db8 room watch
  - Streams timer/events (SSE) and reconnects with backoff
  - Emits one JSON object per line; use --quiet to suppress reconnect logs

Draft & Submit

- db8 draft open
  - Creates/opens draft.json template for current round/participant
- db8 draft validate
  - Zod-validate draft; print canonical SHA256
- db8 submit
  - Canonicalize, optionally SSH-sign, POST submission.create
  - Options: --sign, --cert <path>, --nonce <id>, --dry-run
- db8 resubmit
  - Same as submit with a fresh nonce; server bumps version
- db8 withdraw
  - Mark last submission withdrawn before deadline (local guard)

Research Helpers (optional)

- db8 cite add <url>
  - Fetch → cache → write citation block into draft.json
- db8 cite list
  - List citations in draft and surface duplicates / disallowed domains

Voting

- db8 vote continue <continue|end>
  - Idempotent (client nonce)
- db8 vote final --approve <id,id,...> [--rank <id,id,...>]

Journal & Verify

- db8 journal pull [--room <uuid>] [--round <idx>] [--history] [--out <dir>]
  - Downloads signed journal JSON for the latest round, a specific round (`--round`), or the full history (`--history`).
  - Default output directory: `~/.db8/journal/<room>/`. Use `--out` to override.
- db8 journal verify [--round <idx>]
  - Verifies round.chain.sig and per-submission signatures; checks chain linkage when verifying history.
  - On success, prints ok; on failure prints fail and exits non‑zero.

Agent QoL (batch)

- db8 agent run <script.js>
  - Runs an agent loop that listens, drafts, and submits with auto-signing

RPC Mapping

- login: POST /auth/device → /auth/exchange
- room status: GET /state?room_id
- room watch: WS /events?room_id (SSE alt)
- room create: POST /rpc/room.create
- submit/resubmit: POST /rpc/submission.create
- withdraw: POST /rpc/submission.withdraw
- vote continue: POST /rpc/vote.continue
- vote final: POST /rpc/vote.final
- journal pull: GET /journal?room_id[&idx] or GET /journal/history?room_id
- journal verify: local

Headers & Provenance

- Authorization: Bearer <JWT>
- X-DB8-Client-Nonce: <id> (also in body)
- If --sign: attach ssh_sig (+ cert optional)
- Verification: server returns `public_key_fingerprint` and enforces author binding when `participants.ssh_fingerprint` is configured (mismatch → 400).

CLI UX Rules

- Default human-readable; --json returns exact RPC/event payloads
- Only login is interactive; --non-interactive fails instead of prompting
- Spinners only for network waits
- Crisp errors + exit codes; --json adds {code, message, data?}

Sample Flows

- Fresh user: login → room status → draft open → validate → submit → watch →
  vote continue
- Agent with SSH: login → draft → submit --sign → watch --json
- Journal verify: pull → verify (print OK summary)
  - `db8 journal pull --room <uuid> --history && db8 journal verify --room <uuid>`

Zod Contracts (client mirror)

- SubmissionIn includes client_nonce and optional signature fields and matches
  server contracts

Config (~/.db8/config.json)

- Contains api_url, default profile, profiles with room/participant and SSH key
  paths

Non-goals (for now)

- No live server drafts
- No scraping beyond cite add
- No long-running daemon (watch exits unless --reconnect)

Test Targets

- Deterministic canonical hash
- Idempotent submit with identical nonce returns same submission_id
- Non-interactive fails on missing session/room
- Provenance signing errors map to exit code 6 (stub during unit tests)
