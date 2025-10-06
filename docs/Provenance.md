---
lastUpdated: 2025-10-06
tags: [spec]
milestone: 'M2: Provenance & Journals'
---

# Provenance

This guide explains how db8 canonicalizes submission content, verifies client signatures (Ed25519 or SSH), and enforces optional author binding.

## Canonicalization (JCS)

- Default: RFC 8785 JCS across server, watcher, and CLI.
- Why: stable, cross‑runtime hashing for signatures and journals.
- Toggle: `CANON_MODE=jcs` is the default; legacy sorted‑keys JSON is still available but deprecated.

## Fingerprint Enrollment (Author Binding)

Enroll a participant’s public key fingerprint so the server can bind signatures to authors.

- API: `POST /rpc/participant.fingerprint.set`
  - With key DER (SPKI) base64: `{ participant_id, public_key_b64 }`
  - Or with normalized fingerprint: `{ participant_id, fingerprint }`
    - Format: `sha256:<64 hex>` or bare `<64 hex>` (normalized to `sha256:<hex>`)
- CLI:
  - `db8 provenance enroll --participant <uuid> --pub-b64 <DER base64>`
  - `db8 provenance enroll --participant <uuid> --fp sha256:<hex>`

The server stores a normalized `sha256:<hex>` fingerprint derived from the DER SPKI (Ed25519).

## Verifying Signatures

Endpoint: `POST /rpc/provenance.verify`

Request body:

- Common
  - `doc`: submission object (room_id, round_id, author_id, phase, deadline_unix, content, claims, citations, client_nonce)
  - `signature_kind`: `"ed25519"` or `"ssh"`
  - `sig_b64` (or `signature_b64`): detached signature over the SHA‑256 of the canonicalized doc
- Ed25519
  - `public_key_b64`: DER SPKI (base64)
- SSH
  - `public_key_ssh`: OpenSSH public key string (e.g., `ssh-ed25519 AAAA... comment`)

Response (200 on success):

- `{ ok: true, hash: <64 hex>, public_key_fingerprint: 'sha256:<hex>', author_binding: 'match'|'not_configured'|'unknown' }`

Errors (400/501):

- `missing_public_key_b64` (ed25519), `missing_public_key_ssh` (ssh)
- `invalid_public_key_or_signature`, `invalid_ssh_public_key`
- `unsupported_signature_kind` if an unsupported kind is requested

## Author Binding Enforcement

When `ENFORCE_AUTHOR_BINDING=1` is set, the server requires an enrolled fingerprint for the `author_id` and fails closed on lookup errors.

- If enrolled fingerprint mismatches: `400 author_binding_mismatch`.
- If not enrolled: `400 author_not_configured`.
- If DB lookup fails while enforcing: `503 participant_lookup_failed`.

Without enforcement, the server returns `author_binding: "not_configured"` (or `"unknown"` on transient lookup errors) but still validates signatures.

## CLI Examples

Assume `DB8_API_URL` points to your running server. A sample submission lives at `docs/examples/provenance-document-sample.json`.

- Ed25519 verify
  - `db8 provenance verify --file docs/examples/provenance-document-sample.json --kind ed25519 --sig-b64 <base64> --pub-b64 <DER base64>`

- SSH verify (OpenSSH key string or `@path`)
  - `db8 provenance verify --file docs/examples/provenance-document-sample.json --kind ssh --sig-b64 <base64> --pub-ssh "ssh-ed25519 AAAA... user@host"`
  - `db8 provenance verify --file docs/examples/provenance-document-sample.json --kind ssh --sig-b64 <base64> --pub-ssh @~/.ssh/id_ed25519.pub`

Output includes the canonical hash and the signer fingerprint. Example:

```text
ok 64dc4b430dc09559c794230a3bed11e0d0d9d413a8d2d0a4692811a58f9eaa3a fp=sha256:e3f4… binding=match
```

## Notes

- Temporary files like `.tmp*.prov*.json` are ignored by `.gitignore`.
- JCS is the default; keep clients in sync to avoid hash mismatches.
