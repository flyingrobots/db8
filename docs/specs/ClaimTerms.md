---
lastUpdated: 2026-08-11
tags: [spec]
milestone: 'M8: Structured Claims'
---

# Structured Claims

Scope

- Replace the flat `claim.text` string with a tree that keeps the context a debater wrapped around a proposition.
- Let a verification verdict name _which layer_ it rules on, instead of collapsing "you misquoted the source" and "the source is wrong" into one verdict.
- Give a room a declared predicate vocabulary, so claims stay comparable across debates.

Non-goals

- Deciding whether any proposition is true. The model records what was claimed and under what context; truth is the fact-checker's job, and is recorded separately.
- Extracting claims from prose. db8 participants author claims through a validated API, so there is no inference step and no extractor-confidence layer.
- Replacing `support[]`. Evidence citations stay where they are, attached alongside the claim.

## Why a tree

The current model is a flat list:

```js
Claim = { id, text: string, support: [{ kind, ref }] };
```

A debater writes _"my opponent's cited study claims remote work reduces productivity."_ A checker marks it `false`. That verdict is ambiguous between two entirely different findings — the study does not say that, or the study says it and is wrong — and db8 has nowhere to record which. Flattening also erases the difference between "A, B and C all hold" and "the cause is A, B or C": both become three rows, so a hedge is stored as three assertions the author never made.

Both losses are structural, not cosmetic. Context has to be part of the shape.

## Node kinds

A term is one of seven nodes. `claim` is the only leaf.

| Kind          | Shape                          | Meaning                                |
| ------------- | ------------------------------ | -------------------------------------- |
| `claim`       | `{subject, predicate, object}` | one atomic proposition                 |
| `framed`      | `{frame, body}`                | read `body` under an enclosing context |
| `all`         | `{parts[]}`                    | every part is asserted (1 or more)     |
| `either`      | `{options[]}`                  | an unresolved disjunction (2 or more)  |
| `denial`      | `{body}`                       | the author denies `body`               |
| `conditional` | `{when, then}`                 | `then` applies when `when` holds       |
| `concession`  | `{even_if, still}`             | `still` holds despite `even_if`        |

`concession` is the one node with no counterpart in general claim models, and it earns its place here: "even if you grant X, Y still follows" is one of the most common moves in a debate, and it is the dual of `conditional`. The distinction is load-bearing for what gets fact-checked — see below.

Child order is meaning-bearing and is preserved. `all` and `either` carry the same shape and are still different constructors; nothing may normalize one into the other.

## Frames

A frame wraps a body and says how to read it. The vocabulary is closed — an
undeclared frame kind is a validation error, not a silently accepted string.

| Kind           | Required fields          | Opaque | Example cue                            |
| -------------- | ------------------------ | ------ | -------------------------------------- |
| `attribution`  | `source`                 | yes    | "the study says", "my opponent claims" |
| `belief`       | `holder`                 | yes    | "X believes", "X sees it as"           |
| `hypothetical` | —                        | yes    | "suppose", "for the sake of argument"  |
| `hedge`        | `expression`             | yes    | "may", "possibly", "arguably"          |
| `evaluative`   | —                        | yes    | normative, not empirically checkable   |
| `temporal`     | `at` and/or `expression` | no     | "in 2024", "last quarter"              |
| `domain`       | `restriction`            | no     | "in the US", "among adults"            |

**Opaque** frames suspend assertion: nothing inside them is claimed about the world. **Transparent** frames narrow a proposition without suspending it — "in the US, remote work reduces productivity" still asserts something a checker can rule on, with the restriction carried along as context.

`hypothetical` and `evaluative` are db8-specific and both close real gaps. Debaters run hypotheticals constantly, and without a marker a granted premise reads as an assertion. `evaluative` lets a checker say "this is a value judgment, not a factual claim" rather than being forced to pick `true`/`false` on something unfalsifiable.

## The rule

**Framing never entails the bare proposition.** Wrapping `p` in any opaque frame must never let a consumer read `p` as asserted, and the converse also holds — asserting `p` is not asserting that anyone believes `p`.

This is enforced in one place. `checkableClaims(term)` is the only sanctioned way to turn a term into propositions a fact-checker may rule on. It descends through transparent frames, every part of an affirmed `all`, the body of a `denial` (flipping polarity), and the `still` branch of a `concession`. It stops at every opaque frame, at `either`, at both branches of a `conditional`, and at the `even_if` branch of a `concession`.

It also stops at a _denied_ `all`. "Not (A and B)" entails only that at least one conjunct fails, so denying each part would attribute to the author two claims they did not make. For the same reason an `either` must hold at least two **distinct** options: `either([P, P])` is not an unresolved choice, and since projection stops at every `either` it would otherwise let an author assert `P` while presenting it as a question for nobody to rule on.

`assertsNothing(term)` answers a deliberately broader question — did this submission make any falsifiable claim at all — and so disagrees with `checkableClaims` on attributions and beliefs. "The study says P" yields no checkable proposition, but whether the study said it is itself checkable, and that outer node is exactly what a claim path is for.

That last pair is why `concession` is its own node. In `conditional(when, then)` neither branch is asserted. In `concession(even_if, still)` the consequent _is_ asserted outright — that is the rhetorical force of conceding — while the premise is granted, not claimed.

Each result carries the proposition, its path, its polarity, and the transparent frames above it.

## Predicates

`predicate` is `snake_case`. By default a room accepts any predicate matching that shape.

The default is open on purpose. Free-form predicates across independent authors produce near-zero overlap, which makes cross-debate aggregation — scoring, Elo, any research question spanning rooms — harder. But closing the set at authoring time costs more than it saves: a debate that cannot coin a term mid-debate cannot host a new idea, and pre-declaring the predicate set means deciding in advance which propositions are expressible, which is a bias vector aimed at exactly the thing db8 exists to adjudicate. Establishing that a given vocabulary lets every side state its case is an open research question, not a precondition a room should have to satisfy.

So alignment is a **read-time** concern. `predicatesOf(term)` reports what a term actually used, and reconciliation — synonym maps, clustering — happens over recorded claims rather than by refusing them at the door.

`validateTerm(term, { predicates })` implements an opt-in **strict mode** for rooms that want a closed vocabulary. When strict mode is on the vocabulary is declared up front, at room creation, and an undeclared predicate is rejected at submit time with the offending name in the error. Bootstrapping a vocabulary from round 1 is not supported: it carries the same bias as pre-declaring it, minus the deliberation.

## Paths and verdicts

A path names one node: `$`, `$.body`, `$.parts[1].body`. A verdict records the path it targets, so the two readings that used to collide become separate rows:

- verdict at `$` on an `attribution` node — the source does not say that
- verdict at `$.body` — the source says it, and it is false

Verdict paths and validation error paths are two different grammars, and only the first is addressable.

A **verdict path** names a node. Every path `pathsOf()` enumerates resolves through `atPath()`, and a verdict may only target one of those.

A **validation error path** is a diagnostic and may name a field inside a node. Schema errors from Zod report `$.predicate`, `$.object`, `$.subject.name` and the like; none of those resolve as nodes, because the fields they name are not child slots. Do not feed an error path to `atPath()` and expect a node back.

Where db8 writes the error itself it reports at the owning node: a bad temporal frame is reported at the `framed` node, not at `$…frame`, since `frame` is not a child slot.

Paths are stable because child order is frozen. Any transformation that reorders `all.parts` detaches every path that pointed into it, so terms are stored as authored and rewrites are not permitted without an accompanying path transport.

## Limits

Depth is capped at 16 and size at 256 nodes, inclusive: reaching a limit is legal, exceeding it is not. Both are checked before schema validation so an over-nested term reports the real cause, and both count claim payloads, which are arbitrary JSON and would otherwise exhaust the stack inside the validator.

Numbers in payloads must be finite — `NaN` and `Infinity` have no JSON form and would break canonical hashing. A payload may not use the key `__proto__`: JavaScript cannot carry it as ordinary data, so a payload containing it would validate and come back mutated, and terms are stored as authored.

## Canonical form

Terms canonicalize through db8's existing JCS path (`CANON_MODE=sorted` for the legacy ordering), so `termHash()` is a content address usable for signing and for binding a verdict to exactly the claim that was made. `termHash()` validates first and throws on an invalid term: an unvalidated term can carry payloads with no JSON form, and a content address that collides is not a content address. An unrecognized mode is an error rather than a silent fall back to JCS, so a typo cannot quietly change what gets signed. Key order is normalized; child order is not, because child order is meaning.

## Status

Implemented: `server/claims/terms.js` (schema, validation, canonical form), `server/claims/paths.js` (addressing), `server/claims/checkable.js` (the projection). Tests in `server/test/claims.terms.test.js`.

Not yet wired: rooms have no `predicates` config key, so strict mode (below) cannot be turned on per room. `SubmissionIn.claims` and the `verification_verdicts.claim_path` column land in [#182](https://github.com/flyingrobots/db8/pull/182)'s follow-up branch, `feat/claim-terms-wiring`.

## Prior art

The tree-with-contexts shape, the conjunction/disjunction distinction, and the non-entailment rule are long-standing results in initial-algebra semantics and possible-worlds treatments of attitude reports — Goguen, Thatcher, Wagner & Wright (1977) on initial algebras; Kripke (1963) and Hintikka (1962) on belief; Quine (1956) on why attitude scope order matters; Lewis (1975) and Kratzer (1991) on conditional scope. The node set, frame vocabulary, `concession`, the opacity table, and the room-declared predicate vocabulary here are db8's own, chosen for debate rather than for extraction from prose.
