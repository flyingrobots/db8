---
lastUpdated: 2026-08-11
---

# Changelog

## 2026-08-11 — Structured claims review fixes (breaking)

Review of the M8 groundwork found defects in the claim-term validator, the
non-factivity projection, and the sorted canonicalizer. Every item below was
reproduced before it was fixed.

- Non-factivity
  - `checkableClaims()` no longer distributes a denial across a conjunction. `not (A and B)` entails only that at least one conjunct fails; the projection previously emitted a denial of **each** part, attributing to the author two claims they never made and feeding them into verdict data.
  - `checkableClaims()` no longer projects the consequent of a **denied concession**. Denying "even if X, Y still holds" rejects the concessive relation — X may defeat Y after all — so it does not entail not-Y. Same class as the denied conjunction above.
  - `assertsNothing()` respects opaque ancestors. It shares one descent with `checkableClaims()`, so `hypothetical(attribution(P))` and an attribution inside an `either` or `conditional` branch correctly assert nothing; they previously reported otherwise.
  - `either` now requires at least two **distinct** options. Since projection stops at every `either`, `either([P, P])` let an author assert `P` while presenting it as a choice nobody rules on.
  - `assertsNothing()` now returns false for `attribution` and `belief` frames. The bare proposition stays suspended, but whether the source said it is itself checkable — and that outer node is what claim paths exist for. It deliberately answers a broader question than `checkableClaims()`.
- Validation
  - The depth cap is inclusive: exactly `MAX_DEPTH` (16) levels are accepted and 17 rejected, matching `MAX_NODES` and matching an error that says "exceeds". The effective cap was previously 15 while the message claimed 16.
  - Claim payloads now count against both limits, including every scalar inside a container: counting only containers made `Array(1e6).fill(0)` two nodes, so a payload passed the 256-node cap while Zod and the canonicalizer still walked a million elements. Measurement now stops at the limit rather than traversing the rest. A payload is arbitrary JSON, and `measure()` stopped at claim nodes, so a deeply nested one raised `RangeError: Maximum call stack size exceeded` out of a function documented to return a validation result.
  - A malformed entity reference is rejected instead of matching the generic record branch. `{kind: 'entity', value: 'a_string'}` previously validated and persisted as a record wearing an entity badge.
  - Claim payloads may not use the key `__proto__`. Zod's record parser drops it, so such a payload validated and came back **mutated** — unacceptable for terms that are stored as authored and content-addressed.
  - Validation errors are reported only at addressable paths. A bad temporal frame was reported at `$…frame`, which `atPath()` cannot resolve and `pathsOf()` never enumerates, so a client resolving the error path got `undefined`.
- Content addressing
  - `termHash()` validates first and throws on an invalid term. It previously hashed anything, and since `JSON.stringify` writes `Infinity` as `null`, two distinct terms could share one address.
  - Claim canonicalization reads the validated `CANON_MODE` only. `DB8_CANON_MODE` is a CLI alias and no longer overrides it server-side, which had let signed material drift off the documented server path. An unrecognized `CANON_MODE` is now an error rather than a silent fall back to JCS, matching `config-builder`.
  - `canonicalizeSorted()` preserves a `__proto__` key. Its accumulator was an ordinary object, so assigning that key set the prototype instead of an own property and the key vanished — `{"__proto__": {...}}` hashed identically to `{}`.
- Predicate vocabulary
  - Now documented as **opt-in strict mode**, not the default. A room accepts any `snake_case` predicate unless it declares a vocabulary up front. Closing the set at authoring time would stop a debate from coining a term mid-debate and would decide in advance which propositions are expressible. Cross-debate alignment is a read-time concern; `predicatesOf()` reports what a term used.
- `atPath(term, null)` returns `undefined` instead of resolving the root. `parsePath()` signals failure with `null`, and `?? []` swallowed it, so a malformed verdict path silently targeted `$`.
- Internal: one `CHILD_KEYS`-driven walker replaces four near-identical traversals, and `isNode`/`LIST_KEYS`/`formatPath` are owned by `terms.js` instead of being copied across three files.

Breaking for callers that relied on `termHash()` accepting unvalidated input, on a 16-deep term being rejected, or on a denied conjunction projecting to per-part denials.

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
