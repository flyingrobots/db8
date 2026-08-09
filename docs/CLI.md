---
lastUpdated: 2025-12-23
---

# CLI Specification (db8)

## Name & Install

- **Name**: db8
- **Install**: `npm install && npm link` (Node 20+)
- **Entrypoint**: `bin/db8.js` (ESM)

## Files & Locations

- **Config**: `~/.db8/config.json`
- **Session**: `~/.db8/session.json` (room-scoped JWT; expires)
- **Drafts**: `./db8/round-<idx>/<anon>/draft.json`
- **Journals**: `~/.db8/journal/<room_id>/`

## Environment Variables

- `DB8_API_URL`: Backend endpoint (default: <http://localhost:3000>)
- `DB8_ROOM_ID`: Current active room
- `DB8_PARTICIPANT_ID`: Current participant UUID
- `DB8_JWT`: Active session token
- `DB8_CANON_MODE`: Canonicalization mode (`jcs` or `sorted`)

## Exit Codes

- `0`: OK
- `2`: Validation failed (Zod/Schema)
- `3`: Auth/Session error
- `4`: Phase/Deadline violation
- `6`: Provenance/Signature error
- `7`: Network/Server error
- `8`: Not found
- `9`: General failure

## Global Flags

- `--room <uuid>`: Override room
- `--participant <uuid>`: Override participant
- `--json`: Machine-readable JSON output
- `--quiet`: Suppress non-error output
- `--nonce <id>`: Client-side idempotency key

---

## Commands

### 1. Identity & Auth

#### `db8 login`

Obtain a room-scoped JWT.

- **Flags**: `--room`, `--participant`, `--jwt`, `--device-code` (interactive)
- **Effect**: Writes to `~/.db8/session.json`.

#### `db8 whoami`

Print current room and participant identity.

#### `db8 auth challenge`

Obtain a cryptographic challenge for SSH signing.

#### `db8 auth verify`

Submit an SSH signature to obtain a session JWT.

- **Flags**: `--nonce`, `--sig-b64`, `--kind ssh|ed25519`, `--pub-ssh <key_string|@path>`

---

### 2. Room Management

#### `db8 room status`

Show the current room phase, round index, and countdown timers.

#### `db8 room watch`

Stream real-time events (Timer, Phase flips, Journal commits) via SSE.

- **Flags**: `--quiet`

#### `db8 room create`

Create a new debate room.

- **Flags**: `--topic`, `--participants`, `--submit-minutes`

---

### 3. Participation

#### `db8 draft open`

Create a local `draft.json` scaffold for the current round.

- **Flags**: `--round <idx>`

#### `db8 draft validate`

Validate the local draft against the schema and print the canonical hash.

#### `db8 submit`

Canonicalize and submit the local draft to the server.

- **Flags**: `--path <dir>`, `--nonce <id>`, `--dry-run`

#### `db8 resubmit`

Shortcut to submit with a fresh nonce.

#### `db8 vote continue <continue|end>`

Cast a vote on whether to proceed to the next round.

#### `db8 vote final [--approve]`

Cast a final approval/rejection vote for the debate outcome.

- **Flags**: `--rank <id,id,...>` (optional tie-break)

---

### 4. Moderation & Verification

#### `db8 flag submission`

Report a submission for review.

- **Flags**: `--submission <uuid>`, `--reason <text>`, `--role <role>`

#### `db8 verify submit`

Submit a verification verdict for a claim or submission (Judges/Hosts).

- **Flags**: `--round`, `--submission`, `--verdict <true|false|unclear|needs_work>`, `--claim <id>`, `--rationale <text>`

#### `db8 verify summary`

View aggregated verification stats for a round.

- **Flags**: `--round <uuid>`

---

### 5. Provenance & Journals

#### `db8 journal pull`

Download signed journal history.

- **Flags**: `--history`, `--round <idx>`, `--out <dir>`

#### `db8 journal verify`

Verify the cryptographic chain and signatures of downloaded journals.

- **Flags**: `--history`

#### `db8 provenance enroll`

Link your SSH/Ed25519 public key to your participant ID.

- **Flags**: `--pub-b64 <der_base64>` or `--fp sha256:<hex>`

#### `db8 provenance verify`

Manually verify a local submission file against a signature.

- **Flags**: `--file <path>`, `--sig-b64`, `--kind ssh|ed25519`, `--pub-ssh`
