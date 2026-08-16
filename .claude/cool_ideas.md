# Cool Ideas

Ideas worth discussing, logged as they come up. Not a backlog — no promises here.

---

## 1. Clash detection: find where debaters actually disagree

**Date:** 2026-08-15 · **From:** building `checkableClaims` and the path model

We now have every submission as a tree of `(subject, predicate, object)` leaves with a polarity and a path. That is enough to compute, mechanically, **where two debaters actually contradict each other** — as opposed to talking past each other, which is what most of a bad debate is.

A clash is two checkable claims from different authors with the same subject and predicate and opposite polarity. A _near_-clash is same subject, different predicate — which is exactly the "they're arguing about different things" case, and is arguably the more useful signal.

What makes this cheap: `checkableClaims()` already refuses to project anything behind an opaque frame, so "the study says X" never gets counted as a clash with "not X". The non-factivity work paid for this without meaning to.

Product surface: a "points of contact" panel showing which propositions are genuinely contested, which are asserted by only one side and unanswered, and which are hedged into unfalsifiability by everyone. A debate where the clash set is empty is a debate that did not happen.

Note the open-vocabulary decision cuts against exact matching — `reduces` and `diminishes` will not clash. That is what makes the _near_-clash view valuable, and it is also the read-time reconciliation problem we already said we would solve with synonym maps.

---

## 2. Adapter differential fuzzing

**Date:** 2026-08-15 · **From:** three adapter-drift bugs found by hand

Every adapter-drift bug this month was found either by a human reading carefully or by one hand-written contract test:

- the summary aggregate ignored `claim_path`
- the memory key omitted `client_nonce`, silently discarding a judge's revised verdict
- `total` counted verdict values no column counted

All three have the same shape: generate a random sequence of port operations, run it against every adapter, assert identical observable state. A few hundred lines of property-based test would have found all three without anyone being clever.

The port makes this possible for the first time — before it, there was nothing to fuzz _against_. Worth doing right after the remaining five services get ports, so it covers the whole surface at once rather than one store.

---

## 3. A regression harness built from historical defects

**Date:** 2026-08-15 · **From:** hand-mutating code to prove tests had teeth

Twice this month I reverted a fix by hand to confirm the new test actually went red. That check is valuable and completely ephemeral.

Make it permanent: a directory of small patches, one per historical defect, each with the fix inverted. A `test:mutate` job applies each in turn and asserts the suite fails. If a mutant survives, the test that was supposed to pin that defect has rotted.

This is targeted mutation testing with a curated mutant set, which sidesteps the usual objection to mutation testing (thousands of meaningless mutants, hours of runtime). Candidates already exist: the `claim_path`-less aggregate, the nonce-less key, the shallow canonicalizer, the dead route gate, the ballot-stuffing key, the missing phase gate. Six real mutants, each one a bug that actually shipped.

---

## 4. Assertion density as a scoring dimension

**Date:** 2026-08-15 · **From:** the non-factivity projection

Scoring is currently E/R/C/V/Y — all human judgement. The claim term model makes a new dimension computable: **what fraction of what you said is actually checkable?**

`checkableClaims(term).length` against the total node count gives it directly. A debater who wraps everything in `hedge` and `attribution` has asserted nothing falsifiable and should not score the same as one who committed to propositions and was right.

`assertsNothing()` already exists and answers the degenerate case. This is the continuous version.

Care needed: hedging is sometimes _correct_ epistemic behaviour, and a metric that punishes it teaches overconfidence. Probably a displayed statistic before it is ever a scored dimension — and possibly never scored at all. Worth arguing about.

---

## 5. Citable propositions

**Date:** 2026-08-15 · **From:** the journal, canonicalization and path addressing colliding

Three things now exist that were built separately: content-addressed terms (`termHash`), an Ed25519-signed per-round journal with a hash chain, and paths that name one node inside a claim.

Together they make a **citation to a single proposition inside a debate**, verifiable by anyone: room, round, submission, claim, `$.body`, plus the term hash and the journal signature that covers it. Not "someone said this in a debate" but "this exact proposition, in this exact context, provably unaltered".

That is a genuinely unusual artifact. Ordinary transcripts cannot do it because they have no addressable interior and no signature over what was said.

Prerequisite already known: paths are only stable because child order is frozen and terms are stored as authored. Any future rewrite feature has to carry a path transport or every existing citation breaks.

---

## 6. Predicate drift as a published metric

**Date:** 2026-08-15 · **From:** the open-vocabulary decision

The decision to keep vocabularies open (rather than closed, which would bias what is expressible) leaves a measurable residue: how many distinct predicates a set of debaters use for what is arguably one relation.

The Brain's own trial produced 45, 90 and 12 predicates across three documents with near-zero overlap. That number is not noise — it is a measurement of how much a discourse is failing to converge on shared terms. Track it per room, per topic, over time.

It is also the honest counter-argument to the open-vocabulary choice, kept where it can be examined rather than assumed away. If drift turns out to be catastrophic, this is the evidence that would say so.

---

## 7. Single-implementation assertions

**Date:** 2026-08-15 · **From:** the CLI canonicalizer that had drifted from the server's

`bin/db8.js` carried its own canonicalizer whose `sorted` branch erased nested content — and four lines below it sat the comment _"Imported, not restated: a second copy of this schema drifts from the server the moment either changes."_ The principle was written down, next to the violation, and nobody noticed for months.

A comment cannot enforce that. A test can: assert that exactly one implementation of a named invariant is reachable from both the CLI and the server. Cheap version — grep-based tests that fail if a second `JSON.stringify(value,` or a second canonicalizer definition appears. Better version — a small registry of "there must be exactly one of these", checked in CI.

Same shape as `assertVerdictStore` in the port: a guard that makes a stated rule mechanically true instead of aspirational.
