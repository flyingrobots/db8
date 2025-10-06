---
lastUpdated: 2025-10-04
---

# Changelog

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
