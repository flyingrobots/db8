---
lastUpdated: 2026-08-16
---

# ADR-0004: Randomize test order by default, with a pinned seed

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** James Ross

## Context

Adopting the testing standards prompted an audit of the suite. Section E11 says
the suite must survive randomized order unchanged — so the cheapest way to check
was to run it that way.

**Five of seven seeds failed.** Six files only passed in declaration order:

- `e2e.claim.term.flow` — a `let submissionId` at describe scope, assigned by the
  first test and read by three later ones, failing with `submission_id: undefined`
  when they ran first.
- `claims.verdict.persist` — every test wrote verdicts to one shared submission,
  so "exactly 2 rows" depended on how many later tests had already run.
- `audit.actor.retention` — the retention test needed a deletion performed by the
  test before it.
- `research` — the cache read-back test read what the fetch test had cached. The
  dependency was documented in a comment, which is not a mechanism.
- `audit.integration` — reused a nonce across runs, so `submission_upsert` logged
  `update` rather than `create` on any second run, and the query had no
  `ORDER BY`.
- `scoring` — a four-step script that passed only because the shared database
  still held rows from previous runs.

All six had passed every run for months and would have kept passing
indefinitely, because nothing had ever run them in a different order. Four
careful auditors reading the code found four of them; the config flag found all
six.

The tension: randomization makes failures non-reproducible if the ordering is
different every run, which is a well-earned reason teams avoid it.

## Decision

Shuffle **files and tests** by default, with the seed **pinned** in
`vitest.config.js` and overridable by environment:

```js
sequence: {
  shuffle: { files: true, tests: true },
  seed: Number(process.env.VITEST_SEED ?? 20260816)
}
```

An ordinary run is therefore deterministic and reproducible. Exploring other
orderings is a deliberate act (`VITEST_SEED=12345 npm run test:inner`), and
Vitest prints the seed on every run so a failure carries its own reproducer.

**No retries.** A failure under a particular seed is a real isolation defect.

## Consequences

**Better.** Order dependence cannot silently return. The class of bug is caught
at commit time by a mechanism rather than by review attention — and it found two
more files than the human audit did, which is the argument in one sentence.

**Worse.** A pinned seed explores exactly one ordering. The suite is proven
against seed `20260816` and, at the time of writing, nine others — not against
all orderings. Untested orderings can still hide dependencies, so this reduces
the risk rather than eliminating it. The standards' answer (C6: fixed seed for
reproducibility, fresh seed on a schedule) is only half-implemented; nothing
currently runs a fresh seed periodically.

**Now load-bearing.** The habit of not "fixing" a seed-specific failure by
changing the seed. That would convert a real defect into a hidden one, and it is
the single most likely way this decision gets subverted.

**Must stay true.** Retries stay at zero — Playwright is already explicit about
this (`retries: 0`, with the comment that a flake there would mean a real race),
and Vitest has none configured. Retrying a shuffled suite into green would make
the whole mechanism decorative.

**A known cost, accepted.** One test (`rpc.vote_continue`) flakes at roughly 1 in
45 full-suite runs with a socket-level error. It is not order-dependent — the
seed passes 5/5 on repeat, and the file passes 25/25 alone — so it predates this
decision and is tracked separately rather than papered over with a retry.

## Alternatives considered

**Fix the six files, leave order fixed.** Rejected: it treats the symptom. The
seventh instance would appear the next time someone wrote a two-step test, and
nothing would catch it.

**Shuffle with a fresh random seed every run.** Rejected as the default. It
explores more orderings but makes every failure a one-off that may not reproduce,
which trains people to re-run rather than investigate. Better as a scheduled job
against the pinned default — not yet built.

**Shuffle files only, not tests within a file.** Tempting, since file shuffling
alone passed cleanly. Rejected precisely because of that: **all six defects were
intra-file**, so file-only shuffling would have found none of them.

**`--no-file-parallelism` to make everything deterministic.** Rejected, and this
was tried before in a different context (#177): it costs roughly 5× on every run
and was later diagnosed as the wrong fix for a different problem.

## References

- `vitest.config.js` — the configuration and its reasoning
- Commit `1c14d00` — the six isolation fixes
- Commit `2baa774` — enabling shuffle
- `docs/TESTING-STANDARDS.md` E11, E12, I11, C6
- [#215](https://github.com/flyingrobots/db8/issues/215) — the residual flake
