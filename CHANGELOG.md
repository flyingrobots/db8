---
lastUpdated: 2026-10-29
---

# Changelog

## 2026-10-29 — Testing standards land on main

- **A delayed retry of a score cannot roll back a later revision.** `score_submit` records every nonce in the new table `score_nonces`; a nonce seen before returns the stored score and changes nothing. Before, a judge who scored 10 under nonce A and revised to 90 under nonce B went back to 10 when A was retried.
- **The scores key upgrade refuses to guess.** On a database created before the nonce left the `scores` key, the upgrade keeps the newest score per judge, participant and round. When the newest scores tie on `created_at` and differ, it now stops with `scores_upgrade_ambiguous` instead of keeping one at random.

## 2026-10-26 — A database failure is reported, not hidden in memory

- **With `DATABASE_URL` set, a write the database did not take now answers `503 database_unavailable` and keeps nothing** (#257). Before, the server kept the write in memory and answered `200` with `note: 'db_fallback'`. Memory is lost on restart and other server processes never see it. This covered `nonce.issue`, `submission.create`, `submission.flag`, `vote.continue`, `vote.final`, `room.create`, `score.submit`, `verify.submit`, `research.fetch`, `reputation.update` and `participant.fingerprint.set`. The last two did not even label their fallback: a fingerprint binding was kept only in memory, and a reputation update reported success.
- **The `503` body says what the client may assume.** `outcome: 'not_stored'`: the statement never reached the database. `outcome: 'unknown'`: it may have committed. `docs/LocalDB.md` lists, for each endpoint, whether a retry is then safe (most are, with the same `client_nonce`). Errors the database answered with keep their own status.
- **A configured pool that did not initialize is an outage too**, not memory mode. A cancelled statement (SQLSTATE `57014`, for example a statement timeout) is `not_stored`, because the database rolled it back. A database that does not exist (`3D000`) is `not_stored` too, and its name no longer appears in a `400` message. A failed read gives `not_stored`, never `unknown`.
- **`reputation.update` applies each round once.** `reputation_update_round` now records the round in the new table `reputation_rounds_applied`, and a second call for the same round changes nothing. A round with fewer than two scored debaters is refused with `round_not_scored` and is not marked, so a call after scoring still applies it. Before, every call added the round's Elo deltas again, so a retry after `outcome: 'unknown'` would have counted the round twice.
- **`research.fetch` spends quota only with a stored fetch.** The quota increment and the cache write now run in one transaction. Before, a failure after the increment spent a fetch that the client never received.
- **The MCP agent server keeps its submission nonce on a `503` with `outcome: 'unknown'`**, so a retry cannot store a second turn.
- **Memory mode (no `DATABASE_URL`) is unchanged**, except that its answers no longer carry `note: 'db_fallback'`.
- **Tests that need Postgres now fail without it.** Several suites ran with `DATABASE_URL` set but no database, and passed through the fallback. Run them with the Docker suite (`npm test`).

## 2026-10-26 — A room's predicate vocabulary is enforced

- **A room created with `cfg.predicates` refuses a claim whose term uses another predicate** (#244). #200 stored the vocabulary, but `submission.create` validated terms with no options, so it was never enforced. The answer is `400 invalid_claim_term`, with `claim_id`, `claim_index`, the term `path` and a message that names the predicate. The vocabulary comes from the room of the submitted round, not from the `room_id` in the request. A room without `predicates` accepts any snake_case predicate, as before. Memory mode follows the same rule.

## 2026-10-26 — Concurrent starters agree on one signing key

- **A process that starts while another one creates the signing key pair now adopts that pair instead of refusing to start** (#234). It checked for the private key, then for the public key. When the other process wrote both files between those checks, it saw only the public key and stopped with "signing key missing". It now looks for the private key again before it refuses. A public key with no private key still refuses.

## 2026-10-26 — A room sets its own round timing

- **`room.create` accepts `cfg.continue_vote_seconds` (10–3600, default 30), and `cfg.submit_minutes` now applies to every round** (#228). `round_publish_due` hard-coded a 30-second continue-vote window, and `round_open_next` gave every round after round 0 a 300-second submit window. LLM agents often missed the 30-second vote, and a round with no votes ends the debate. Both sweeps now read the room's config. A room without these keys keeps 30 s and 300 s. A stored value that is not a valid integer in range gives the default, so one room's config cannot fail a sweep for every room.
- `room_create` and the Zod schema refuse an out-of-range `continue_vote_seconds`. The CLI has `room create --continue-seconds`.
- Memory mode uses the same settings. Without them, the next round's submit window comes from `SUBMIT_WINDOW_SEC` (default 300), not a fixed 300.

## 2026-10-26 — A replayed room_create changes nothing

- **Replaying `room_create` with the same `client_nonce` returns the existing room and changes nothing** (#249). The replay seeded `agent_1..agent_N` again with `ON CONFLICT DO NOTHING`, so a replay with a larger `participant_count` added seats, and the stored `participant_count` no longer matched the room. A replay no longer fills in a missing title either. The two pgTAP assertions that #238 marked TODO for this now pass.

## 2026-10-26 — A nonce names one document

- **Reusing a submission's current `client_nonce` with a different document is refused with 409 `nonce_reused`** (#236). Before #237 the upsert rewrote only the hash, leaving the old content beside a hash of a document nobody stored; after #237 it replaced the document silently, so a retry and an edit looked the same. Replaying the same document under the same nonce still returns the same id; a resubmission uses a fresh nonce. Memory mode follows the same rule.

## 2026-10-25 — One submission per participant per round

- **A resubmission replaces the earlier submission** (#237). `submissions` was unique on `(round_id, author_id, client_nonce)`, so `db8 resubmit` (a fresh nonce) added a second row that was published and journaled beside the first. The key is now `(round_id, author_id)`; `submission_upsert` replaces content, claims, citations and hash, keeps the id, and bumps a new `version` column. The audit entry records `version` and `previous_sha256`.
- Replaying the same nonce with the same document returns the same id and changes nothing.
- Replaying a nonce that a resubmission superseded is refused with 409 `nonce_superseded`; it would otherwise undo the newer document. A replacement after the round has left `submit` (or its deadline has passed) is refused with 409 `submission_closed`, because flags and verdicts on the published document stay attached to the same id.
- Replacements are serialized per round and author, so each audit entry's `previous_sha256` names the version it actually replaced.
- Upgrading a database: in rounds still in `submit`, older drafts are dropped and the newest kept. In rounds that have published, every row is kept (it is in a signed journal) and older duplicates are marked `legacy_duplicate`. One-per-author is a partial unique index over the unmarked rows.
- Memory mode follows the same rule, including `nonce_superseded`; it does not check the round phase.

## 2026-10-25 — The pgTAP suite tells the truth

- **`db/test/run.sh` fails on a failing assertion, a plan mismatch or a SQL error** (#238). psql exits 0 for all three, so the suite reported success while `30_rpcs` failed three tests and three files had wrong plans.
- Assertions made inside `DO` blocks (`10`, `20`, `30`, `44`) are now reported: pgTAP discards their TAP lines, so a failure there showed only as a plan mismatch. Surfacing them found a wrong test (finalization is `round_open_next`'s job, not `round_publish_due`'s) and a real bug, #249.
- `throws_ok` in `30_rpcs` uses the four-argument form; the three-argument form compared each description with the error message. Plans are corrected.
- Known failures are TODO with their issues: #208 (RLS) and #249.
- CI can run the suite: a `workflow_dispatch` input `run_pgtap`, and a step that installs pgTAP into the Postgres service.

## 2026-10-25 — CLI `--timeout` works

- **`--timeout <ms>` now bounds every API request the CLI makes** (#235). It was listed in the help and read by no command, so a server that accepted the connection and never answered held the CLI forever. A timeout prints `request to … timed out after <ms> ms` and exits 7; a value that is not a positive integer exits 2. `room watch` streams over SSE and is not bounded by it.

## 2026-10-25 — Agent seats over MCP

- **`bin/db8-mcp.js`** (`db8-mcp`) is a stdio MCP server that seats one LLM agent in one room, bound to a seat by `DB8_ROOM_ID` and `DB8_SEAT` (or `DB8_PARTICIPANT_ID`). Tools: `debate_status`, `debate_wait`, `debate_submit`, `debate_vote_continue`, `debate_vote_final`; resource `db8://guide`; prompt `debate_agent_loop`. It uses the HTTP API only. See [docs/MCP.md](docs/MCP.md) (#231).
- `/state` transcript entries now carry `round_id`, and `round_idx` with a database, so clients can group turns by round.
- `note: 'db_fallback'` now means only "a configured database failed and the write lives in memory", including a pool that failed to initialize. Memory mode by configuration no longer labels continue votes, final votes or `nonce.issue` answers with it.
- Memory mode: a repeated continue vote with the same ballot key revises the choice, as `vote_submit` does; final ballots are kept (one per voter per round) and `/state` reports `final_tally`; transcript entries carry `round_idx`.
- A continue vote that `vote_submit` refuses (wrong phase, closed window) is now a 400, as final votes already were. Before, the server counted it in memory and answered 200.

## 2026-10-25 — Room config is stored

- **`room_create` stores its `cfg` in `rooms.config`** (#200). It read `participant_count` and `submit_minutes` and then dropped the rest, so every room's config was `{}`. Research quotas (`max_fetches_per_round`) were therefore never enforced, and `attribution_mode` could not be switched on.
- `POST /rpc/room.create` accepts `max_fetches_per_round`, `attribution_mode` (`masked` or `real`) and `predicates` (snake_case) besides the two existing keys, and rejects invalid values with 400. Unknown keys are dropped.
- Memory-mode `room.create` stores the same config, so `room.get` answers alike in both modes.
- Not wired yet: the submission path does not read `predicates`, so strict vocabularies are stored but not enforced (#244).

## 2026-10-25 — Publish when every debater has submitted

- **`round_publish_due` publishes a `submit` round as soon as every debater in its room has submitted to it**, instead of always waiting for the deadline (#229). The deadline rule is unchanged. Hosts and judges do not hold a round open, and a room with no debaters still waits for its deadline.
- The publish audit entry records `reason`: `deadline` or `all_submitted`.
- Memory mode is unchanged and still publishes at the deadline only.

## 2026-10-25 — One continue vote per participant

- **A participant's continue vote counts once per round.** `votes` was unique on `(round_id, voter_id, kind, client_nonce)`, so a voter who sent ballots under fresh nonces was counted once per nonce, and one participant could decide whether the debate continued (#227). The key is now `(round_id, voter_id, kind)`; `vote_submit` replaces the earlier ballot, and replaying a nonce still returns the same id.
- Upgrading a database that already holds duplicate ballots keeps each voter's newest ballot, then swaps the constraint, in the same way as `final_votes`.
- Memory mode follows the same rule: a later ballot replaces the earlier one in the tally.

## 2026-10-24 — Room and seat lookup

- **`GET /rpc/room.get?room_id=<uuid>`** returns a room's topic, status, config and seats (`id`, `anon_name`, `role`), ordered by seat number so `agent_2` precedes `agent_10`. Before this, `room.create` returned only `room_id`, `/state` had no topic or roster, and a participant could learn their id only from Postgres (#230).
- An unknown room is 404 `room_not_found`; a non-UUID id is 400 `invalid_room_id`. If the database is configured but unreachable, the answer is 503 `database_unavailable` rather than a 404 for a room that exists. Rooms created in memory during the outage are still answered, including after the database recovers.
- Room metadata is read through a new `rooms_view` (`security_barrier`), so `room.get` follows the rule that server reads go through views.
- Memory-mode `room.create` now seeds `agent_1..agent_N` debaters like SQL `room_create`, so both modes answer with the same shape.
- CLI: `db8 room seats` (`--json`), exit 8 for an unknown room.

## 2026-10-24 — Blind submission at the read path

- **`/state` no longer shows a submission while its round is in `submit`.** Its transcript read every submission in the room through `submissions_with_flags_view`, which had no phase filter and relied on RLS that does not take effect (#208), so a debater could read an opponent's turn before writing their own (#226).
- The view now returns a submission only when its round is `published` or `final`, or to its own author when `db8.participant_id` is set. `final` is included, unlike the RLS read policy, so a finished debate keeps its transcript.
- Memory mode fails closed: a submission is shown only if its round is known to have published. A submission naming an unknown round id, such as the CLI's placeholder, stays hidden. Memory-mode `room.create` rooms now carry a `round_id`.

## 2026-08-16 — Architecture Decision Records

- **`docs/adr/` established**, with a template, an index, and an explicit "Owed" list naming decisions made in code but never written down. An ADR records one decision, the context that forced it, and what it costs; it is immutable once accepted, and a reversal supersedes rather than edits. Consequences **must** include the bad ones.
- Five recorded, all decisions actually taken rather than reconstructed: [0001](docs/adr/0001-persistence-chosen-by-configuration.md) persistence adapters chosen by configuration and never by failure, and why `err.severity` is the discriminator; [0002](docs/adr/0002-record-sorted-canonicalization-divergence.md) recording the `sorted` integer-key divergence instead of fixing it, because the fix invalidates every signature over a document with numeric keys; [0003](docs/adr/0003-delete-historical-docs.md) deleting stale documentation rather than archiving it behind a banner; [0004](docs/adr/0004-randomized-test-order.md) randomized test order with a pinned seed; [0005](docs/adr/0005-rescope-stale-issues-in-place.md) re-scoping stale issues in place rather than closing and refiling.
- Wired in rather than left as a directory: a page type in the documentation standards, a step in the `AGENTS.md` loop, a review-checklist line, an entry in the routing index, and pointers from the code each one governs (`ConfiguredVerdictStore`, `vitest.config.js`, `canonicalization.test.js`).
- ADR-0001 records that its own pattern is **incomplete** — five services still fabricate an identifier for a write that did not happen and return it under `200 {ok:true}`. Naming that inside the ADR keeps the gap visible instead of implying the decision was fully applied.
- `docs/specs/OrchestratorHeartbeat.md` has required an ADR by name since it was written; that one is listed as owed rather than invented, since the rationale for choosing a heartbeat over an advisory lock was never recorded.

## 2026-08-16 — Documentation standards, and three defects the rewrite found

- **Standards split out of `AGENTS.md`**, which had grown to 1429 lines — 350 of standards on top of ~1000 of 2025 session logs, milestone status, and merged-PR debriefs. Now a short file that states how to work here and link to [testing](docs/TESTING-STANDARDS.md) and [documentation](docs/DOCUMENTATION-STANDARDS.md) standards. Historical pages are deleted rather than archived: git history holds them, and a stale page cannot mislead anyone once it is gone.
- **`docs/Teardown.md`** — an end-to-end explanation from process entry point to durable row, for a reader with no prior knowledge. **`README.md`** rewritten as a front door that teaches from one real submission and its real digest.
- **Submissions are not hidden before publication.** `db/rls.sql` carries a policy saying they are; it does not take effect. No table sets `FORCE ROW LEVEL SECURITY`, the API connects as the table owner (a superuser with `rolbypassrls` in the default setup), and views default to `SECURITY DEFINER`. The view `/state` reads has no phase filter of its own — its `CASE` handles attribution masking, and the phase predicate only suppresses flags. Verified directly: with a round still in `submit`, a second debater querying the statement `RoomService` issues gets the opponent's row back, `content` included. Simultaneous submission is the property the format exists to provide.
- **`db8 journal verify` does not bind `core` to `hash`.** It verifies the signature over `hash` but never recomputes `sha256(canonicalize(core))`. Demonstrated by rewriting a signed journal's vote tally to 99–0 and watching verification still pass. It also reads the verifying public key from the journal being verified, so there is no trust anchor, and it re-fetches from the live API rather than checking the artifacts `journal pull` wrote to disk.
- **No route reads the `Authorization` header.** It appears in the server only as an allow-listed CORS header name. `author_id`, `voter_id`, and `reporter_id` are taken from the request body at face value; the JWT the server mints carries `alg: "none"` with the literal string `sig` where a signature belongs. `POST /rpc/participant.fingerprint.set` is likewise unauthenticated, which inverts the author-binding guarantee.
- These three are documented in [the README's security posture](README.md#security-posture) and §11 of the Teardown rather than left implicit. None is a design disagreement; the row-level-security one is a two-line fix.

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
