---
lastUpdated: 2026-08-09
---

# Changelog

## 2026-08-09 — `GET /journal` indexed lookups (breaking)

- `GET /journal?room_id&idx=<n>` now returns **404** when the room has no such round, in both the database and in-memory paths. It previously returned **200** carrying the room's _latest_ journal, so a request for round 999 was answered with round 0 under `ok: true`.
- A non-integer or negative `idx` now returns **400** `invalid_idx`. It was previously coerced (`Number('abc')` → `NaN`) and silently fell through to the latest journal.
- The not-found response carries a 404 status rather than a 200 with `ok: false`; callers branching on status code read the old form as success.

Callers that treated any 2xx as "journal found" must now handle 404, and callers that passed unchecked `idx` values must handle 400.

## 2026-08-08 — Structured claims (M8 groundwork)

- Claim terms
  - New tree-shaped claim representation replacing the flat `claim.text` string: seven node kinds (`claim`, `framed`, `all`, `either`, `denial`, `conditional`, `concession`) over a closed seven-kind frame vocabulary.
  - `concession` (`even_if`/`still`) is db8-specific — the dual of `conditional`, and the node that lets "even if you grant X, Y still follows" assert Y without asserting X.
- Non-factivity
  - `checkableClaims()` is the only sanctioned way to turn a term into fact-checkable propositions. Opaque frames (`attribution`, `belief`, `hypothetical`, `hedge`, `evaluative`) suspend assertion; transparent frames (`temporal`, `domain`) narrow it and carry through as context.
  - Each result carries polarity and the path it came from.
- Path addressing
  - `$.parts[1].body`-style paths so a verdict can name which layer it rules on — "the source does not say that" and "the source says it and is wrong" become separate findings.
- Predicate vocabulary
  - Rooms may declare an allowed predicate set; undeclared predicates are rejected at validation with the offending name. Keeps claims comparable across debates.
- Limits and canonical form
  - Depth capped at 16, size at 256 nodes, both checked before schema validation. Non-finite numbers rejected. Terms hash through the existing JCS path, so `termHash()` is a content address usable for signing.
- Docs
  - `docs/specs/ClaimTerms.md`.

## 2025-10-04 — PR #118 merged (M2 foundations)

- Canonicalization
  - Adopt RFC 8785 JCS as the default (`CANON_MODE=jcs`). Legacy `sorted` remains available for compatibility.
- Nonces (server-issued)
  - Atomic DB path via `submission_upsert_with_nonce(...)` to consume-and-insert in one step.
  - Clear fallbacks: `invalid_nonce` → 400; otherwise log DB error and fall back to memory (when enabled) with TTL + single-use semantics.
  - Issuance (`/rpc/nonce.issue`) only falls back for infra errors; validation/constraints surfaced as 400.
  - Memory guardrails: UUID v4 format, TTL, per-(round,author) windowed limit, global lazy sweep.
- Journals
  - Endpoints: `GET /journal`, `GET /journal?idx`, `GET /journal/history`.
  - Web: `/journal/[roomId]` history page with client-side Ed25519 verify and clear ‘unsupported’ status.
- Docs
  - Documented `CANON_MODE`, `ENFORCE_SERVER_NONCES`, signing keys, and journal endpoints + CLI verify.
- Tests
  - TTL expiry for nonces; canonicalizer selection in tests respects `CANON_MODE`.
- Misc
  - Journal building avoids mutating DB rows; single numeric coercion prevents NaNs.
