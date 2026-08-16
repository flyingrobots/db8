---
lastUpdated: 2026-08-16
---

# Changelog

## 2026-08-16 — Testing standards, and the tests they condemned

- **Testing standards adopted** in `AGENTS.md`: rule-ID'd sections A–K governing any change that adds, modifies, or deletes a test, or that fixes a defect. Rule IDs are stable and citable in commits and review.
- **Two canonicalization tests were tautologies.** `canonicalizeJCS(v)` is defined as `return canonicalizeJcsLib(v)`, and both tests asserted the two were equal — `lib(x) === lib(x)`, which no input can fail. One was titled "handles edge cases (unicode keys, numbers, -0, null chars)" and looped four fixtures, so it read as though the hard cases were pinned; nothing was. The oracle is now RFC 8785 itself, as literal expected strings never computed by a canonicalizer, covering code-unit member ordering with locale ignored, an astral-plane key sorting by its leading surrogate, ECMAScript number formatting including `-0`, and minimal escaping.
- **`sorted` canonical form is not lexicographic for integer-like keys.** `Object.keys(v).sort()` looks like it orders keys lexicographically, but JavaScript emits integer-index properties first in ascending numeric order and silently overrides the sort — so `sorted` mode emits `{"2":..,"10":..}` where a lexicographic sort, and JCS, emit `{"10":..,"2":..}`. Reachable, since a claim term's `object` is arbitrary JSON and reaches the signed digest. Output is still deterministic, so db8 agrees with itself and signatures are not wrong; an independent implementation of `sorted` doing a true lexicographic sort would disagree and fail verification. Recorded as a labelled divergence rather than changed, because resolving it changes every signature over a document with numeric keys.
- **Six suites only passed in declaration order** and now arrange their own fixtures: a submission id filled by one test and read by three others, verdict-row counts that grew as later tests added rows, an audit assertion needing an earlier test's delete, a cache read of what an earlier test fetched, a nonce reused across runs so an upsert logged `update` instead of `create`, and a four-step scoring script that passed only on residue left by previous runs.
- **Test order is randomized by default**, files and tests, with a pinned seed printed on every run and overridable via `VITEST_SEED`. Before this, five of seven seeds failed; now ten seeds pass across both persistence modes and both passes of `npm test`.
- Assertions that stopped at a success indicator now assert the effect: submission acceptance reads the transcript back, rubric scores are read back field by field, the research cache compares the snapshot it returns against the one the fetch stored, and the Elo test asserts the better-scored debater ends above the default rating and the worse-scored below it rather than merely "not 1200".

## 2026-08-15 — Verdict persistence behind a port

- `VerificationService` no longer knows Postgres exists. Persistence sits behind a `VerdictStore` port with a Postgres adapter, a memory adapter, and a selector that chooses by configuration — never by failure. Path resolution stays above the port, because `server/claims/paths.js` owns the grammar and resolving per-adapter would be two implementations free to disagree.
- One contract suite runs against every adapter. The two adapters had already drifted twice — the summary aggregate ignored `claim_path`, and the memory key omitted `client_nonce`, so a judge's revised verdict was silently discarded — and neither was visible while each adapter was tested alone.
- **Memory-mode verdict writes are now refused at a capacity bound** rather than evicting. Eviction made the summary report fewer findings than were filed; unbounded growth exhausted the heap, since `client_nonce` mints a new identity. A repeat of an existing verdict is still answered when full, so retry-after-timeout stays idempotent.

## 2026-08-15 — Final vote integrity, CLI canonical form, and test isolation (breaking)

- **One ballot per voter.** `final_votes` was keyed `(round_id, voter_id, client_nonce)`, so a voter resubmitting under a fresh nonce inserted a _second_ row and `view_final_tally` counted both — a result could be inflated by looping with new nonces. The key is now `(round_id, voter_id)` and `vote_final_submit` upserts on it, so a resubmission revises the ballot. Databases carrying the old key are deduplicated to the most recent ballot per voter, under an `ACCESS EXCLUSIVE` lock so a concurrent insert cannot slip in before the constraint is added.
- **A final vote requires the final phase.** `vote_submit` refuses a round that is not in a voteable phase; `vote_final_submit` checked participation only, so a ballot was accepted in any phase.
- **A rejected final vote is no longer reported as accepted.** `VoteService` caught every query error and fell back to memory, so the phase rejection returned a fabricated `vote_id` with HTTP 200. Errors Postgres replied with (they carry `severity`) now propagate; only a genuinely unreachable database falls back.
- **The CLI canonicalizes through the same code as the server.** `bin/db8.js` carried its own implementation whose `sorted` branch used a replacer _array_ — an allow-list applied at every depth — so nested keys were deleted and a submission's claims and citations canonicalized to `{}`. Two different arguments produced one digest, and anything signed under `sorted` failed verification. `server/canon-mode.js` now resolves a mode in one place and validates it; an unrecognized mode is an error rather than a silent fall back to the broken branch. `db8 submit` also stopped printing its own digest over the server's, and now fails if the response carries none.
- **Tests no longer apply DDL at runtime.** `db/rls.sql` locks `rooms` before `rounds` and `db/rpc.sql` the reverse, which deadlocked about one run in five. `prepare-db` applies the test helpers instead, and the one remaining schema test runs inside an isolated scratch schema so it cannot contend with anything.

## 2026-08-15 — Cross-origin access, and browser tests

- **The web app could not reach the API from a browser.** `web` serves on :3001, the API defaults to :3000, `apiBase()` builds an absolute URL and there is no proxy — so every response was blocked with `No 'Access-Control-Allow-Origin' header is present`. `state` never loaded, and the room page rendered a shell with no submission form. Confirmed in Chromium, not inferred.
- `server/cors.js` grants cross-origin access to an allow-list, configured with `DB8_ALLOWED_ORIGINS` (comma-separated) and defaulting to the local dev web origins. Never `*`: these endpoints accept a bearer token, and an open policy would let any page a participant has open call them with that participant's credentials. Responses carry `Vary: Origin` so a cache cannot serve one origin a header meant for another.
- Browser tests for the claim term editor in `web/e2e/`, run with `npm run test:e2e` from `web/`. Deliberately not part of `npm test`, which runs on every push: requiring a browser engine there would make an ordinary commit depend on a 95MB install.

## 2026-08-11 — Claim terms wired through submissions and verdicts (breaking)

- Submissions
  - `Claim.text` is replaced by `Claim.term`, a structured claim term. `id` and `support` are unchanged — evidence is orthogonal to term structure and replacing it is a stated non-goal.
  - The submission path enforces `validateTerm`, not just the term's shape. Wiring `term` to the bare schema left the depth and size caps, the `__proto__` refusal, `either` distinctness and temporal anchoring enforced nowhere a real submission passed through. Two layers now: the schema field delegates to `validateTerm` so no caller can forget it, and the route returns a structured `invalid_claim_term` naming the offending claim.
- Web
  - The room page gained a claim term editor: every node kind, recursively nested, with the frame vocabulary, an opaque/transparent explanation, a plain-English read-back, and incomplete slots reported before submit.
- Verdicts
  - `verification_verdicts.claim_path` records which node of a claim term a verdict rules on. The uniqueness index includes it, so a verdict on an attribution and a verdict on the proposition it attributes are two rows rather than one overwriting the other.
  - `claim_path` is exposed through `verification_verdicts_view` and grouped by `verify_summary`, in both the SQL and the in-memory aggregate. Without that the scoring aggregate merged the two findings the column exists to separate.
  - A `claim_path` that names no node in the claim's term is rejected as `claim_path_not_found`. Parsing proves syntax, not existence.
  - `verify_submit` gains `p_claim_path`. The pre-`claim_path` seven-argument overload is dropped explicitly: `CREATE OR REPLACE` does not replace across a changed argument list, and because the new parameter has a default a seven-argument call fits both signatures and Postgres refuses it as not unique.

Breaking for any client sending `claim.text`, and for any deployment calling `verify_submit` with seven arguments.

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
  - Errors db8 writes itself are reported at the node that owns them. A bad temporal frame was reported at `$…frame`, which `atPath()` cannot resolve and `pathsOf()` never enumerates, so a client resolving that error path got `undefined`. Schema errors from Zod still name fields (`$.predicate`, `$.subject.name`) and are diagnostics, not verdict targets — the spec documents the split.
- Content addressing
  - `termHash()` validates first and throws on an invalid term. It previously hashed anything, and since `JSON.stringify` writes `Infinity` as `null`, two distinct terms could share one address.
  - Claim canonicalization reads the validated `CANON_MODE` only. `DB8_CANON_MODE` is a CLI alias and no longer overrides it server-side, which had let signed material drift off the documented server path. An unrecognized `CANON_MODE` is now an error rather than a silent fall back to JCS, matching `config-builder`.
  - `canonicalizeSorted()` preserves a `__proto__` key. Its accumulator was an ordinary object, so assigning that key set the prototype instead of an own property and the key vanished — `{"__proto__": {...}}` hashed identically to `{}`.
- Predicate vocabulary
  - Now documented as **opt-in strict mode**, not the default. A room accepts any `snake_case` predicate unless it declares a vocabulary up front. Closing the set at authoring time would stop a debate from coining a term mid-debate and would decide in advance which propositions are expressible. Cross-debate alignment is a read-time concern; `predicatesOf()` reports what a term used.
- `atPath(term, null)` returns `undefined` instead of resolving the root. `parsePath()` signals failure with `null`, and `?? []` swallowed it, so a malformed verdict path silently targeted `$`.
- Internal: one `CHILD_KEYS`-driven walker replaces four near-identical traversals, and `isNode`/`LIST_KEYS`/`formatPath` are owned by `terms.js` instead of being copied across three files.

Breaking for callers that relied on `termHash()` accepting unvalidated input, on a 16-deep term being rejected, or on a denied conjunction projecting to per-part denials.

## 2026-08-09 — Toolchain: eslint 10 and a Node 22 floor

- The supported Node version is now **22 or newer**. `eslint-plugin-unicorn` evaluates `Set.prototype.union` at module load, and that method does not exist before Node 22, so on Node 20 `npm run lint` fails with a `TypeError` before linting anything. Pinned in `.nvmrc`, `package.json` engines, `docker-compose.test.yml`, and all three workflows.
- `.npmrc` sets `legacy-peer-deps=true`, and it is required: `eslint-plugin-react@7.37.5` peer-caps at eslint `^9.7` and npm refuses the tree without it. Remove it when upstream ships an eslint 10 peer.

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
