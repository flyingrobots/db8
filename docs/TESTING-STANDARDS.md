---
lastUpdated: 2026-08-16
tags: [standard]
---

# Testing Standards

Applies to every change that adds, modifies, or deletes a test, and to every change that fixes a defect. Language- and stack-agnostic. Rule IDs are stable; cite them in commit messages and review comments (e.g. "violates A3").

## Before you write a test

Answer these four in the test body or a one-line comment. If you cannot answer one, do not write the test yet.

1. **Promise** — what externally meaningful thing does this claim? If you cannot state it without naming a function, you are testing structure.

2. **Boundary** — which contract boundary exposes it? Test at the narrowest one that owns the behaviour.

3. **Oracle** — where does the expected value come from? One of: spec (best), reference/published vectors, invariant/relation, prior version or other implementation, current output (worst; see G1).

4. **Failure** — what will you break to watch this go red, and will the message name the check?

## A. Boundaries and assertions

- **A1** Exercise the system through a contract boundary: a surface some party outside this code's change control depends on. Determine boundaries by actual dependency, not by visibility keywords.

- **A2** Use the narrowest boundary that owns the behaviour. Do not default to the outermost entry point.

- **A3** Never reach past a boundary to read or set an internal. Never widen visibility for a test.

- **A4** If a behaviour needs direct testing and sits behind no boundary, propose extracting it as a module with its own interface. Do not test it in place.

- **A5** Do not pin a helper with one or two callers with its own tests.

- **A6** Assert on observable outcomes: return values, durable writes, emitted messages, exit codes, rendered artifacts, refusals, released resources, absence of a forbidden effect.

- **A7** Never assert on internal state, structure, or call sequence, except under A9.

- **A8** Do not stop at a success indicator. `status == 200` without asserting the effect is not a test.

- **A9** Interaction/mock assertions are allowed only when the interaction crosses a contract boundary and _is_ the promise (exactly-once charge, published event, audit row, bounded cache consultation). Assert the minimum — occurrence or count — not a full argument-by-argument call trace. Interactions between collaborators inside a module: never.

- **A10** Prefer semantic projections over verbatim output: parsed records over serialized text, sets where order is unspecified, required fields over whole-object equality.

- **A11** Universal claims ("every timestamp pinned", "no field leaks a secret") must walk the output and check every match. Never enumerate the fields you expect to exist.

- **A12** Existence claims must enumerate. A walk cannot see what is absent.

- **A13** Every walked assertion must report the population it examined: `found 37 timestamp fields; all pinned`. An assertion that cannot distinguish "all 37 passed" from "none found" is vacuous.

- **A14** Walk predicates are deny-by-default: any unrecognized shape fails. A regex over `secret|token|password` passes a field named `credential_blob`; that is the failure to design against.

## B. Calibration — the load-bearing rule

- **B1** Every load-bearing assertion must be observed failing, once, for the right reason. Break its subject, run it, see red.

- **B2** The red must come from that assertion, not from a crash or a compile error before it runs. If the mutation stops the assertion from executing, you learned nothing.

- **B3** The failure message must name the specific check.

- **B4** An assertion that still passes when its subject is deleted is not a weak test; it is not a test. Remove or repair it.

- **B5** Ordering is not mandated. Test-first satisfies B1; writing the test after and then deliberately breaking the code satisfies B1 equally. The obligation is the observed red. (Exception: D3.)

- **B6** Never compute `expected` with the same helper, constant, parser, or normalizer used for `actual`. A circular oracle mutates and fails correctly while proving nothing — B1 cannot detect this, so check it separately.

- **B7** Zero assertions executed is a failure, not a pass. Watch for skips, early returns, and assertions inside callbacks that never fire.

- **B8** Never gate on, target, or report a mutation score. Mutation analysis is scoped to changed lines and its survivors are triaged as: missing test, weak oracle, or accepted gap.

## C. Quantified claims

- **C1** If the promise quantifies over inputs — for all, never, always agrees, unchanged — the test must quantify over inputs. More examples do not discharge a universal.

- **C2** "This refactor changed nothing" requires differential evidence against the pre-change system over generated inputs.

- **C3** Property-test total transformations. Default candidates: round-trip, idempotence, commutativity, order-insensitivity, monotonicity.

- **C4** Where no single-output oracle exists, assert metamorphic relations: `f(shuffle(xs)) == f(xs)`, adding a filter never increases result count.

- **C5** Log the seed outside the test process before running, so a crash cannot take the reproducer with it.

- **C6** Run with a fixed seed for reproducibility; run with a fresh seed on a schedule so exploration accumulates.

- **C7** Shrinking must be enabled. A 40 KB counterexample has found a bug and hidden it in the same gesture.

- **C8** Promote every minimized counterexample into a checked-in corpus and replay it thereafter as a deterministic case.

- **C9** Characterize the corpus. "10,000 cases" must not mean 9,999 empty strings.

- **C10** State the two lies of a differential oracle in the test: correlated failure (both implementations misread the spec identically) and reference error (the harness freezes the reference's bug). Keep spec-derived examples alongside generators.

- **C11** When behaviour is deliberately changed, retire or re-scope every differential test bound to the old behaviour in the same commit.

## D. Defect fixes

- **D1** A reproducible defect is not fixed until the suite contains a test that exhibits it.

- **D2** That test must be observed red **against the unfixed code**. "It would have failed" is a counterfactual, not evidence — reproductions are frequently wrong and this is when you find out.

- **D3** Evidence it: put the failing test in one commit and the fix in the next, or attest mechanically that the test fails on the parent commit. **This is the one place ordering is mandatory.**

- **D4** Encode the correct behaviour at the boundary, never the mechanism of this particular fix — otherwise the regression test dies at the next refactor while the bug's whole family survives.

- **D5** Fix the class: one example for the reported case, plus a property or boundary sweep for its family.

- **D6** Irreproducible defect: the obligation converts, it does not lapse. Add the invariants, state checks, and logging that make the next occurrence self-reporting; widen the exploration budget (F1–F3); record what reproduction was attempted; leave the defect open as a suite deficiency. "Trivial", "hard to test", "the patch is obvious", and "we need to ship" are not exemptions.

## E. Determinism and isolation

- **E1** Never consult the wall clock, ambient randomness, the network, thread scheduling, or ambient identity except through a harness-supplied substitute.

- **E2** Inject a clock; default to a fixed epoch; compute durations from a monotonic source.

- **E3** Inject the random generator; fix the default seed; print the seed on failure.

- **E4** Obtain identifiers, keys, and temp paths from a harness-controlled generator.

- **E5** Never read ambient env, locale, timezone, hostname, or DNS unless the harness set it.

- **E6** Never sleep as a synchronization mechanism.

- **E7** Add a seam only for a nondeterminism source the code actually consults. Do not abstract speculatively.

- **E8** Retrofit via an allowlist of non-conforming call sites that only shrinks, ratcheted in CI. A frozen allowlist is a violation.

- **E9** A test's outcome may depend only on the code under test, its checked-in inputs, and the harness.

- **E10** Own your scratch state: fresh temp dir, schema, or namespace per test, created in setup, destroyed in teardown, partitioned per parallel worker.

- **E11** The suite must survive randomized order and self-parallel execution unchanged. Never depend on another test's execution, order, or residue.

- **E12** Build fixtures per test from builders with valid, boring defaults and named overrides. Shared mutable fixture state is forbidden — editing a fixture for test 41 silently re-specifies tests 1–40.

- **E13** Sharing infrastructure is fine when isolation is preserved by rollback, snapshot, or namespacing. The ban is on shared state, not shared containers.

- **E14** Share only immutable contracts: conformance vectors, protocol suites, fuzz corpora, canonical data. Never share code whose job is to set a scene.

- **E15** Bind port 0 and read back the assignment. No hardcoded ports. No ambient egress — a test reaching the internet must fail, not pass slowly.

- **E16** Any claim of determinism must ship the seed, clock, schedule, and build identity needed to reproduce.

## F. Adversarial testing

- **F1** Fuzz continuously everything that parses, decodes, deserializes, or interprets input across a trust boundary. Targets live with the source and build with the tests so they cannot rot. Run with assertions and sanitizers on. Supply a seed corpus and, for structured formats, a dictionary — uniform random bytes never pass a header. Strengthen past "did not crash" wherever possible: round-trip fixpoints, cross-implementation agreement, invariant checks; a crash oracle cannot see silent acceptance of invalid input. Minimize, dedupe, and check in the corpus; replay it as cheap regression coverage on machines that never fuzz.

- **F2** Concurrency: control scheduling decisions and record the schedule of every run. Looping a racy workload is not a concurrency test and must not be offered as evidence. Ladder, be on the highest rung the architecture supports: (1) inject executors and dispatchers as seams so concurrent code runs deterministically with explicit interleaving points; (2) seeded scheduler exploring a different order per run; (3) systematic exploration with preemption bounding, scoped to the concurrency core; (4) full deterministic simulation, or external history checking against a consistency model. Assert safety and liveness separately, liveness by progress/divergence detection rather than by nobody observing a hang. A race detector satisfies none of this — it says nothing about linearizability or deadlock. Every concurrency failure carries its schedule or seed; without a reproducer it stays open.

- **F3** Fault injection: every claim to survive crash, restart, power loss, torn write, full disk, allocation failure, timeout, cancellation, partition, or clock skew is tested by injecting that fault from a recorded seed. Advance the failure point systematically across the operation, integrity-checking after each iteration. Exercise **stacked faults** — a fault during recovery from a prior fault; nobody imagines these spontaneously. Keep a fault-type × system-phase matrix per subsystem and review it for empty cells. Recovery-point and recovery-time promises are ordinary assertions with numbers in them; an unexecuted runbook is not evidence. The failure artifact is the seed.

## G. Change-detecting artifacts (goldens, snapshots, approvals)

- **G1** Legitimate only where the artifact itself is the contract: wire formats, generated code against a spec, compiler diagnostics, rendered documents. Label it as change detection; never present or review it as a specification.

- **G2** Minimize to the behaviour guarded — the error message, not the stack trace.

- **G3** Canonicalize before capture: strip timestamps, absolute paths, addresses, hash-order iteration, line endings. A golden that varies by machine is a flakiness generator in a costume.

- **G4** Re-baseline only as a reviewed change, landing with the behaviour change that motivated it, with a diff small enough to read. A diff too large to review means split the test, not skim faster.

- **G5** No bulk re-baselines. Decompose per behaviour or attach the H2 declaration. Regeneration tooling should be inconvenient enough to force reading the diff.

- **G6** An artifact that moves during a declared refactoring **is the bug report**. Investigate; do not re-bless.

- **G7** Known failures are pinned, never commented out or skipped: an expected-failure test asserting the _correct_ behaviour, with owner, defect link, and expiry.

- **G8** Expected-failure semantics are symmetric: an unexpected **pass** fails the suite until the pin is removed and the test promoted to gating.

- **G9** Expected failure ≠ quarantine. Quarantine is for verdicts you do not trust; expected-failure verdicts are trusted and inverted.

## H. Shape of tests

- **H1** One test per behaviour, never one per function, method, or class.

- **H2** Declare which of four kinds every change is — refactoring, feature, defect fix, behaviour change — and check the test diff against the declaration.

- **H3** A refactoring must not touch existing tests or goldens. If it does, either it is not a refactoring or the tests were bound below the right boundary. Resolve before merging.

- **H4** A new feature must not modify existing tests.

- **H5** Only a declared behaviour change may edit an existing expectation.

- **H6** One behaviour ≠ one assertion. Several assertions establishing one atomic promise (rejected transfer changes neither balance nor ledger nor audit count) are correct and better than fragmenting the evidence.

- **H7** Name tests as sentences about behaviour: `transfer_rejected_when_balance_insufficient`, not `test_process_2`. A name needing "and" is two tests.

- **H8** Body is arrange/act/assert with no conditionals and no ad-hoc loops. A loop over cases is the harness's parameterization; a conditional is two tests.

- **H9** Assertions carry their subjects and emit structured diffs. Never a bare boolean.

- **H10** Failure output states desired outcome, actual outcome, and the relevant parameters — enough to start investigating from the name and message alone.

- **H11** Any test with generated inputs, injected faults, or randomized order prints a one-line replay command including the seed.

- **H12** Review test code as rigorously as production code, optimizing for obviousness over DRY. If you need a test for your test, back out.

## I. Suite economics

- **I1** Declare a size class per test. **Small**: one process, no network, no filesystem, no database, no extra threads, no sleeps. **Medium**: one machine, loopback only. **Large**: everything else.

- **I2** Enforce sizes in the sandbox, not the style guide — a "small" test that opens a socket must _fail_.

- **I3** Test each behaviour at the smallest size that can honestly express it, and at two sizes only with a recorded reason.

- **I4** Budget latency per class as an SLO tracked at p95, so relabelling a slow test cannot game it. Small tests belong in milliseconds.

- **I5** Stage tiers: small blocking every merge; medium pre-merge; large, sanitizer, platform matrix, long fuzz, mutation, fault, and performance work on a schedule.

- **I6** A flaky test is a defect in the test or in the system, never a fact of nature.

- **I7** Detect flakiness statistically before a test may gate: repeat, shuffle, run in parallel with itself.

- **I8** Remove a flaky test from the gate the same day.

- **I9** Quarantine does not suppress execution or reporting. It keeps running, keeps reporting, and its failures keep accruing to its owner — a quarantine that hides results is a deletion with extra steps.

- **I10** Every quarantine entry has an owner and a fix-by date within four weeks, then resolves into a repair or a deletion. Unowned on arrival: delete.

- **I11** Never retry a test into green as a merge condition. A test that needed a retry has already told you it can lie. Record retry counts; do not absorb them.

- **I12** Give each class a numeric flake budget. "Flakiness matters" is a sentiment; "under 0.5% of small-test runs" is enforceable.

- **I13** Treat every flake as a defect report against the _system_ until proven otherwise. A race in the harness and a race in production look identical from outside.

- **I14** Use coverage for exactly one question: what did we not exercise?

- **I15** Never gate on, target, or report a project-wide coverage percentage. Changed-line coverage may be a review signal, and at most a soft gate a component's owners choose for themselves.

- **I16** Never present coverage as evidence of correctness. Execution without an oracle proves nothing.

- **I17** Coverage dropping on unchanged source means the _suite_ changed. Investigate.

- **I18** Declare deletion criteria in advance. Valid: the behaviour was removed; a stronger and cheaper test subsumes it; a quarantine expiry elapsed; it is a change-detector nobody can interpret; it fails B1 and nobody can say what it protects.

- **I19** Record which criterion fired and where the displaced risk now lives. Deleting a red test to green the build is not a criterion.

## J. CI gates

- **J1** Run required verification automatically on the smallest safe set of changes before integration. Failures block by default, name an owner, and resolve into a repair, a revert, or an expiring written waiver. A broken mainline outranks feature work.

- **J2** **May gate**: hermetic small and medium suites green with no retries; B1 demonstrations for new load-bearing assertions; the D3 red-on-parent attestation; contract verification for cross-team surfaces; crash-level fuzz findings; sanitizer failures; size-class and hermeticity violations; G8 symmetry breaches; performance regressions past a generous declared tolerance against a same-run baseline.

- **J3** **May not gate**: whole-project coverage percentages; mutation scores; results from suites over their flake budget; any metric whose natural variance exceeds its threshold; anything retriable into green.

- **J4** Test selection is dependency-aware and validated periodically against a full run. Unvalidated selection is an untested optimization applied to your only safety net.

- **J5** Every failure emits: command, seed, environment and build hash, logs, diffs, minimized counterexamples.

- **J6** Release gates run the full relevant matrix, not the presubmit subset.

- **J7** Diagnostic surfaces, invariant checks, and replay hooks are product capabilities, not test tooling. A test that detects "invalid history" but cannot expose the operations, events, fault schedule, and persisted state that produced it is sensitive and operationally useless.

## K. Performance

- **K1** State the hypothesis before running.

- **K2** Report a distribution: p50, p90, p99, max. A mean alone does not conform — a p99 regression with a flat median is invisible to a mean-based gate.

- **K3** Never derive latency figures from standard deviation.

- **K4** Account for coordinated omission: a load generator whose next request is delayed by the stalled system deletes exactly the backlog that hurt users.

- **K5** Pin or randomize confounders: machine class, frequency scaling, placement, run order, link order, environment size. Link order alone can flip the sign of a measured optimization.

- **K6** In uncontrolled environments compare ratios against a **same-run baseline**. Absolute thresholds across runs rot as hardware drifts.

- **K7** Calibrate the harness twice: against a known fixed-latency service to check the recorded distribution, and against a deliberately pessimated build to confirm the benchmark can see the regression it exists to catch. B1 applies to benchmarks.

- **K8** Gate on a regression tolerance against a baseline on one declared hardware class, never an absolute bar. Controlled experiments run in the scheduled tier; a labelled same-run-relative smoke benchmark may run per commit for trend signal.

## Self-check before you submit

Run this list. Cite the rule ID for anything you deliberately did not satisfy, with the reason.

1. Every new assertion was seen red for the right reason, and the message named the check. (B1–B3)

2. No assertion computes `expected` from the same helper as `actual`. (B6)

3. Every walked assertion reports its population count. (A13)

4. Nothing reaches past a boundary; no visibility was widened for a test. (A3)

5. Every interaction assertion crosses a boundary and is the promise. (A9)

6. Defect fixes contain a test observed red on the parent commit. (D2–D3)

7. No clock, RNG, network, scheduler, env, or identity read outside a harness seam. (E1–E5)

8. No shared mutable fixture; suite passes shuffled and self-parallel. (E11–E12)

9. Every generative test logs its seed outside the process, shrinks, and promotes counterexamples. (C5–C8)

10. Every test declares a size class it actually honours. (I1–I3)

11. No golden re-baselined in bulk; none moved during a declared refactoring. (G5–G6)

12. The change declares which of the four kinds it is, and the test diff matches. (H2–H5)

13. Nothing was added to the gate that can be retried into green. (I11, J3)

14. No coverage or mutation percentage is cited as evidence of quality. (B8, I15–I16)

## Never do these

- Assert only that a call happened when you could assert what it produced. (A8)

- Add a getter, make a field public, or subclass to reach an internal. (A3)

- Enumerate the fields you expect instead of walking what is there. (A11)

- Write an assertion and never watch it fail. (B1)

- Skip the failing test because the fix is obvious. (D6)

- Sleep to wait for something. (E6)

- Retry until green. (I11)

- Regenerate a snapshot to make the build pass. (G5, G6)

- Delete a red test to unblock CI. (I19)

- Report a coverage or mutation percentage as a quality result. (B8, I16)

- Claim a test is deterministic without recording the seed, clock, schedule, and build. (E16)

- Close a concurrency bug without a reproducing schedule or seed. (F2)

## Out of scope for automated agents

Do not claim compliance with these; flag them for a human owner instead: quarterly suite-trust reporting; strategy documents naming who accepts each untested risk; waiver approval; adoption of structural coverage criteria for a component; deletion of tests whose displaced risk you cannot locate.

## Contested — positions taken here, with the counterargument

- **Ordering** (B5): calibration is mandatory, test-first is not; sequencing shows no measured effect on quality while cycle granularity does. Counter: test-first is cheaper to audit and is a design practice outcome studies do not capture. Nothing here forbids it, and D3 mandates ordering where the evidence is strongest.

- **Interaction assertions** (A9): permitted at boundaries where the interaction is the promise. Counter: any permission gets exploited, and a flat ban survives staff turnover better than a judgment call.

- **Coverage** (I15): changed-line coverage may be a signal or a component-scoped soft gate. Counter: any number invites assertion-free tests, which are worse than absent tests because they are indistinguishable from real ones at a glance.

- **Expected-failure inversion** (G8): unexpected passes fail. Counter: pinning a currently-failing promise teaches readers that red is acceptable; ownership and expiry exist to answer this.

- **Suite shape**: no ratios are mandated; budgets (I4, I12) are the enforceable constraint. Counter: a default shape is useful compression of the flakiness gradient. Integration-dominant systems will rationally invert any recommended pyramid.
