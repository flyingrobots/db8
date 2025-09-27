# CLI Quickstart

The db8 CLI is currently provided as a local binary in this repo. It targets Node 20+.

## Install (local)

```
# from the repo root
npm link   # makes `db8` available on your PATH
```

## Identity helpers

```
db8 whoami          # prints room/participant if configured
```

## Room state

```
db8 room status     # prints current phase/timers snapshot from /state
```

## Draft & submit

```
db8 draft open      # creates ./db8/round-0/anon/draft.json
$EDITOR db8/round-0/anon/draft.json

db8 draft validate  # runs Zod locally; prints canonical SHA256

db8 submit          # canonicalizes and POSTs to /rpc/submission.create
db8 submit --dry-run  # prints canonical SHA + nonce without sending to the server
```

Flags & env

- Global flags: `--room`, `--participant`, `--json`, `--nonce`
- Env vars:
  - `DB8_API_URL` (default: http://localhost:3000)
  - `DB8_ROOM_ID`, `DB8_PARTICIPANT_ID`, `DB8_JWT` for authenticated flows

Notes

- Idempotency: submissions and votes de‑duplicate by client nonce.
- Provenance: `--sign` (SSH) lands in a later milestone; server accepts unsigned in M1.

For full command spec, see docs/CLI.md.
