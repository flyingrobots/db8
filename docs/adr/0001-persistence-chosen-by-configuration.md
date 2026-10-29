---
lastUpdated: 2026-08-16
---

# ADR-0001: Persistence adapters are chosen by configuration, never by failure

**Status:** Accepted
**Date:** 2026-08-15
**Deciders:** James Ross

## Context

db8 runs in two persistence modes. With `DATABASE_URL` set, everything goes to
Postgres. Without it, the process serves entirely from in-memory maps — which is
what makes demos, the browser tests, and most of the suite possible without a
database.

Every service reached that second mode the same way: wrap the query in
`try/catch`, and on any error fall through to memory. It reads as resilience.
What it actually does is conflate two completely different events:

1. **The database was unreachable.** A durability failure. Arguably survivable,
   but only if the caller is told.
2. **The database answered, and said no.** A phase gate, a role check, a
   uniqueness constraint — the rules working exactly as designed.

The second case shipped as a defect. `vote_final_submit` had just been hardened
so that a final vote requires the `final` phase and one ballot per voter is a
uniqueness constraint. `VoteService` caught the phase rejection, fell back to
memory, and returned **HTTP 200 with a fabricated `vote_id`**. The database had
worked perfectly and refused an invalid ballot; the caller was told it had been
accepted. The enforcement that had just been added was thrown away one layer up.

The mirror-image defect appeared on the verify path at the same time: an
over-eager wrapper turned `round_not_verifiable` into `503 database_unavailable`,
telling clients the service was down when the database had answered and said no.

Separately, the two verdict implementations had already drifted twice — the
summary aggregate ignored `claim_path`, and the memory key omitted `client_nonce`
so a judge's revised verdict was silently discarded. Both were invisible while
each adapter was tested alone.

## Decision

Persistence is a **configured choice, not a fallback**.

For the verdict subsystem — the pilot for this pattern — a `VerdictStore` port
defines the contract, `PostgresVerdictStore` and `MemoryVerdictStore` implement
it, and `ConfiguredVerdictStore` selects between them on one criterion:

```js
get delegate() {
  return this.dbRef.pool ? this.durable : this.memory;
}
```

It routes on **whether a database is configured**, never on whether one is
failing. A configured database that errors surfaces `database_unavailable` and
the request fails.

Three supporting rules make it hold:

- **A rule the database enforced is not an outage.** Postgres sets `severity` on
  anything it _replied with_, whatever the SQLSTATE; a connection that never got
  an answer has none. `PostgresVerdictStore.#query` propagates any error carrying
  `severity` with its original object intact, and wraps only the rest.
- **One contract suite runs against every adapter.** A behaviour asserted once
  and executed N times is the point.
- **The port is not a base class.** It is JSDoc plus `assertVerdictStore`, a
  wiring-time duck-type check — because a base class would let an adapter
  inherit an implementation and silently skip the shared suite.

## Consequences

**Better.** A judge is never told their verdict was recorded when it was only
held in a process about to restart. Adapter drift is caught by construction
rather than by a careful reader. Memory mode is a peer, not a lesser path, so
"works in memory but not durable" stops being possible for the covered surface.

**Worse.** Availability drops: a database blip that previously produced a
degraded `200` now produces a `503`. That is the intended trade — the previous
behaviour was not availability, it was a lie about durability — but it is a real
change in failure mode.

**Now load-bearing.** `err.severity` as the discriminator. If a driver upgrade
stopped setting it, every DB-enforced rejection would silently become a `503`.
The test asserts on **object identity**, not message, precisely so a replacement
error carrying the same text cannot pass while losing `code` and `severity`.

**Must stay true.** Path resolution has to stay _above_ the port — resolving
per-adapter would be two implementations free to disagree, which is the bug this
ADR exists to prevent. And because `verify_submit` does not re-check the path,
`forRequest()` must keep pinning one delegate for the whole operation, so a pool
swap between the read and the write cannot validate against one store and persist
through another.

**Incomplete.** This pattern covers verdicts only. By its own standard, five
other sites still fabricate an identifier for a write that did not happen and
return it under `200 {ok:true}`: `VoteService.castContinueVote`,
`SubmissionService.create` (whose carve-out is a _message regex_, not `severity`),
`ScoringService.submitScore`, `RoomService.createRoom`, and
`AuthService.setFingerprint`. Each is the same bug class the changelog already
describes. Extending the pattern is outstanding work, not a settled position.

## Alternatives considered

**Keep the catch-all fallback, add logging.** Rejected: the caller still receives
`200` and a fabricated id. Logging tells the operator, not the client, and the
client is the one making a durability decision.

**Distinguish by SQLSTATE.** Rejected as too narrow — it requires enumerating
every code the RPCs raise and maintaining that list. `severity` is set by
Postgres on everything it replies with, so the discrimination is structural
rather than a list to keep in sync.

**Make memory mode read-only, or delete it.** Rejected: it is what lets the
browser tests and most of the suite run without a database, and the demo path
depends on it. The problem was never that memory mode existed — it was that it
was reachable by accident.

**An abstract base class for the port.** Rejected explicitly. An adapter could
inherit a default implementation and pass the contract suite without ever
executing its own code.

## References

- `server/ports/VerdictStore.js` — the contract and `assertVerdictStore`
- `server/adapters/ConfiguredVerdictStore.js` — selection policy
- `server/adapters/PostgresVerdictStore.js` — the `err.severity` discrimination
- `server/adapters/MemoryVerdictStore.js` — refuse-at-capacity rather than evict
- `server/test/verdict.store.contract.test.js` — the shared suite
- `server/test/verify.durability.test.js` — identity-not-message assertions
- `CHANGELOG.md`, 2026-08-15 — "a rejected final vote is no longer reported as accepted"
