---
lastUpdated: 2026-08-16
---

# Architecture Decision Records

An ADR records **one decision, the context that forced it, and what it costs**.
It is written when the decision is made and never edited afterwards except to
change its status. If the decision is reversed, a new ADR supersedes the old one
and the old one stays exactly as it was.

That immutability is the whole point. A living document tells you what is true;
an ADR tells you _why someone chose it_, including what they knew at the time and
what they were worried about. Both are useful, and the second is the one that
gets lost.

## When to write one

Write an ADR when a choice is **hard to reverse, or cheap to reverse but easy to
forget**:

- a boundary moves — what belongs in SQL, in a service, in an adapter;
- a rule gets enforced somewhere new, or deliberately stops being enforced;
- a defect is recorded rather than fixed, and the reason is a trade-off;
- a convention is adopted that later readers would otherwise treat as arbitrary;
- an alternative was seriously considered and rejected.

Do **not** write one for a routine bug fix, a refactor with no boundary change,
or anything a code comment covers adequately.

The test: _if someone changed this next year without knowing why it was chosen,
would that be a bad day?_ If yes, write the ADR.

## How

1. Copy [`template.md`](template.md) to `NNNN-short-kebab-title.md`, taking the
   next free number.
2. Fill in Context, Decision, Consequences, and Alternatives. Consequences must
   include the bad ones — an ADR that lists only benefits is marketing.
3. Link it from the index below.
4. Reference it from the code or spec it governs, so a reader arrives at it.

Status is one of **Proposed**, **Accepted**, **Superseded by ADR-NNNN**, or
**Deprecated**.

## Index

| ADR                                                       | Title                                                              | Status   |
| --------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| [0001](0001-persistence-chosen-by-configuration.md)       | Persistence adapters are chosen by configuration, never by failure | Accepted |
| [0002](0002-record-sorted-canonicalization-divergence.md) | Record the `sorted` canonicalization divergence rather than fix it | Accepted |
| [0003](0003-delete-historical-docs.md)                    | Delete stale documentation rather than archive it                  | Accepted |
| [0004](0004-randomized-test-order.md)                     | Randomize test order by default, with a pinned seed                | Accepted |
| [0005](0005-rescope-stale-issues-in-place.md)             | Re-scope stale issues in place rather than closing and refiling    | Accepted |

## Owed

Decisions that have been made in code but never written down, or that a spec
explicitly asks for and nobody has recorded. Listed so they are visible rather
than implied:

- **Orchestrator liveness: heartbeat vs advisory locks.**
  [`docs/specs/OrchestratorHeartbeat.md:19`](../specs/OrchestratorHeartbeat.md)
  requires this ADR by name. The heartbeat approach shipped; the rationale for
  choosing it over a Postgres advisory lock was never recorded, and the recovery
  path it enables has never been able to fire
  ([#104](https://github.com/flyingrobots/db8/issues/104),
  [#205](https://github.com/flyingrobots/db8/issues/205)). Whoever resolves those
  should write this at the same time.
- **Why the round lifecycle has a second implementation in memory mode.**
  `server/services/RoomService.js` reimplements the phase machine that
  `db/rpc.sql` owns, with different window lengths. That is either a deliberate
  trade for testability or an accident; nobody has said which.
- **Open predicate vocabularies.** The decision and its reasoning are recorded in
  [`docs/specs/ClaimTerms.md`](../specs/ClaimTerms.md) rather than here, which is
  acceptable — but a future reader looking for the bias/expressivity argument
  will look in this directory first.
