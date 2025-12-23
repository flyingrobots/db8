# Expert 004: Final Statement

## Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Expert ID:** 004
**Domain:** Formal methods, provenance tracking, correctness proofs, deterministic guarantees, formal verification
**Phase:** Final Statement
**Date:** 2025-12-20

---

## Executive Summary

After analyzing all three rounds of debate, I recommend **Fixed Timestep with Suspend/Resume as the primary architecture**, with careful attention to the formal verification requirements that my domain brings to this decision. However, I must also document why the pre-computed deterministic schedules approach (which I proposed earlier) ultimately fails on rigorous grounds, and what that teaches us about temporal systems in deterministic environments.

The convergence I see in the debate is not toward a technical victor—all major proposals can achieve determinism and efficiency—but toward recognition of a deeper principle: **in provenance-tracked systems, the temporal coordinate is not an optimization detail. It is a first-class formal object that must appear explicitly in the ledger.**

---

## What This Debate Revealed

### The Core Insight: Temporal Coordinates are First-Class

From my domain's perspective, the most important realization is that deterministic replay requires an explicit, globally-agreed temporal coordinate system. This is not a performance optimization question—it is a _correctness question_.

**The formal theorem underlying this debate:**

For any system with provenance tracking (ledger, journal, proof of computation), if temporal ordering matters for correctness, then temporal coordinates must be:

1. Explicit in the ledger (not derived)
2. Monotonically increasing across all replicas
3. Deterministically computable from the ledger alone
4. Immune to floating-point accumulation

**This theorem eliminates several proposals:**

- Pure event-driven with variable-Δt scheduling: Violates #4 (floating-point drift)
- Pre-computed deterministic schedules: Violates #1 and #3 (schedule checksum becomes part of verification surface)
- Run-length encoding for empty ticks: Violates #2 and #3 in distributed settings (requires consensus on which ticks are "empty")

Only fixed-timestep tick indices satisfy all four requirements trivially.

### Why My Pre-Computed Schedules Proposal Failed

I must acknowledge that my Round 1 proposal for pre-computed deterministic schedules, while mathematically sound on its face, failed the rigor that formal verification demands:

#### Failure 1: Schedule Interruption Semantics

I proposed:

```typescript
function computeDampingSchedule(v0: Vec2): Schedule {
  const ticks: Array<{ delay: number; velocity: Vec2 }> = [];
  // ...
  return { type: 'DampingSchedule', ticks, checksum: hash(ticks) };
}
```

But Expert 001 correctly identified that user input can interrupt a schedule:

```
Tick 0: PanStart → schedules 23-tick damping (checksum=0xABCD)
Tick 50ms: User clicks (interrupt!)
```

My proposal required ledger entries like:

```
Receipt[0]: ScheduleGenerated(ticks=23, checksum=0xABCD)
Receipt[1]: UserClick (interrupts schedule)
```

**The formal problem:** I now need to define and prove a function:

```
interrupted_schedule(original, interrupt_time) → modified_schedule
```

This function must be:

- **Pure**: No floating-point rounding affecting the result
- **Deterministic**: Same input → same output across all platforms
- **Idempotent**: Replaying with the same interruption produces the same ledger
- **Provably correct**: Somehow the new schedule + the interrupted receipts must produce the same state as if the interruption never happened (impossible!)

**The core issue:** Interrupted schedules create **forking causality paths**. Once interrupted, the schedule that was "going to happen" no longer happens—but the ledger must explain _why_. This requires either:

1. Logging the schedule cancellation (adds complexity to ledger)
2. Logging why the cancellation was correct (requires proof of interruption necessity)
3. Treating interruption as a state mutation (but state mutations should flow through rules, not the scheduler)

Fixed timestep avoids this entirely: every tick fires, inputs are queued, no interruption logic needed. The scheduler never needs to make commitments it might need to break.

#### Failure 2: The Checksum Surface Explosion

I proposed checksumming the schedule to verify determinism:

```typescript
{ type: 'DampingSchedule', ticks, checksum: hash(ticks) }
```

But this creates a new verification surface. To prove the system correct, I must prove:

```
∀ input v0, ∀ damping_factor d:
  hash(computeDampingSchedule(v0, d)) = canonical_hash(v0, d)
```

And this proof requires specifying:

- The exact hash algorithm (SHA-256? BLAKE3?)
- The serialization format for `ticks` array
- Floating-point rounding semantics during computation
- Platform-dependent behavior (what if `Math.pow` behaves differently on x86 vs ARM?)

Fixed timestep has no such checksum: the tick index _is_ the coordinate system. Correctness proofs don't need to verify "tick 42 happened correctly"—tick 42 is the specification.

#### Failure 3: The Epsilon Problem is Not Solved, Only Relocated

Both Expert 001 and Expert 003 identified that my proposal still required choosing an epsilon threshold:

```typescript
while (v.magnitude() > EPSILON) {
  // compute next tick
}
```

This epsilon affects the schedule length. If I choose epsilon=0.01, the schedule might have 23 ticks. If epsilon=0.001, it might have 46 ticks. Different replicas with different floating-point behavior might converge at different iterations.

**Formally:** I've moved the non-determinism from "when to stop ticking" to "how many ticks to schedule." I haven't eliminated it—I've just hidden it in the schedule generation function.

Fixed timestep with suspend/resume keeps the epsilon visible: `if (velocity < EPSILON) suspend()` is an explicit state transition recorded in the ledger.

---

## The Convergence: Why Suspend/Resume is Correct

After all three rounds, I see that Expert 005's suspend/resume pattern is not just pragmatic—it is formally correct in a way that pure event-driven systems cannot be.

### The Formal Model of Suspend/Resume

```typescript
// Temporal state space
type TemporalState =
  | { phase: 'active', tick: ℕ, systemState: State }
  | { phase: 'suspended', tick: ℕ, systemState: State }

// Transition function
transition(s: TemporalState) → TemporalState =
  match s.phase:
    | 'active' where velocity(s.systemState) < EPSILON
        → { phase: 'suspended', tick: s.tick, systemState: s.systemState }
    | 'active' otherwise
        → { phase: 'active', tick: s.tick + 1, systemState: step(s.systemState) }
    | 'suspended' where input_available()
        → { phase: 'active', tick: s.tick + 1, systemState: s.systemState }
    | 'suspended' otherwise
        → { phase: 'suspended', tick: s.tick, systemState: s.systemState }
```

**Formal properties this achieves:**

1. **Temporal monotonicity**: `tick` is strictly increasing except during suspension where it freezes
2. **Explicit temporal transitions**: Suspension/resume are observable state changes in the ledger
3. **Deterministic time advancement**: Next tick is always `current_tick + 1` (or unchanged during suspension)
4. **No floating-point accumulation**: Tick indices are integers; no rounding errors
5. **Distributed consensus is tractable**: All replicas agree on tick indices; suspension is a ledger event subject to consensus

This is _provably_ deterministic in ways that other approaches are not.

### Why Suspend/Resume Preserves Provenance Better Than Alternatives

From a formal methods perspective, the provenance-tracking function is:

```
provenance(state_t) → proof that ∃ tick_sequence, ledger_entries such that
  apply(initial_state, tick_sequence, ledger_entries) = state_t
```

**With fixed timestep (always active):**

- Ledger contains tick indices 0, 1, 2, ..., N (even empty ones)
- Provenance proof includes these empty ticks
- This creates "noise" in the proof: you must explain why a tick had no effect

**With suspend/resume:**

- Ledger contains: tick sequence with explicit suspend/resume boundaries
- Provenance proof jumps from `Tick N suspend` directly to `Tick N resume`
- No noise: the gap is explained by the suspend event

**Formally, suspend/resume provides a cleaner provenance:**

```
proof_size(fixed_timestep) = O(wall_clock_time)
proof_size(suspend_resume) = O(event_count)
```

This matters for:

1. **Verification cost**: Smaller proofs are easier to check
2. **Debuggability**: When something goes wrong, provenance traces are more readable
3. **Compliance**: Auditors can follow the causal chain without wading through empty ticks
4. **Certification**: Formal verification tools scale better with proof size

---

## The Formal Verification Perspective

### What Must Be Proven for Determinism

In my domain, we distinguish between several levels of determinism guarantee:

#### Level 1: Weak Determinism

"The same input always produces the same output on the same machine."

All proposals achieve this. The question is whether floating-point behavior, scheduling order, or timer granularity affects the result.

#### Level 2: Strong Determinism

"The same input always produces the same output on any machine, any compiler, any processor."

This is significantly harder. It requires:

- Fixed Δt for numerical calculations (eliminates variable-timestep event-driven)
- Deterministic scheduling with total order on events (eliminates race conditions)
- Explicit temporal coordinates (eliminates derived timestamps)

**Fixed timestep with suspend/resume** achieves strong determinism:

```
Ledger entry → Tick index (integer, unique, monotonic) → Can replay on any machine
```

Pre-computed schedules cannot:

```
Ledger entry → Schedule checksum → Need to verify hash matches on target platform
```

#### Level 3: Formal Verification Complete

"Mathematical proof that the system satisfies its specification."

This requires the entire temporal model to be:

1. **Decidable**: Queries about temporal properties are computable
2. **Composable**: Proofs of subsystems combine into proofs of the whole system
3. **Checkable**: Automated theorem provers can verify the proofs

Fixed timestep is far more compositional:

```
Theorem: ∀ tick_sequence, ledger_entries:
  apply(initial, tick_sequence, ledger_entries) is deterministic
```

This is straightforward to prove. Each tick is a pure function of (state, input), and tick sequences are integers.

Pre-computed schedules create compositional challenges:

```
Theorem: ∀ schedules, interruptions:
  apply(initial, interrupted_schedules, ledger_entries) is deterministic
```

This requires a proof of schedule interruption semantics, which creates new proof obligations for each interruption pattern.

---

## Acknowledging Expert 002's Valid Points

I must also address the performance engineering perspective that Expert 002 raised. In formal methods, we don't ignore performance—we incorporate it as a formal property.

### Performance as a Formal Specification

Rather than dismissing "zero idle overhead" as merely pragmatic, I propose we formalize it:

```
Specification: During any period [t1, t2] where:
  - velocity = 0
  - no user inputs
  - no scheduled rules

Then:
  - CPU_wakeups = 0
  - Ledger_entries = 0
  - Wall_clock_time can advance arbitrarily
```

This specification is achievable. Both fixed timestep + suspend/resume and event-driven + pre-computed schedules satisfy it (once formalized correctly).

The difference is in the proof burden. With suspend/resume:

```
Proof: When velocity < EPSILON, the state machine enters Suspended phase.
During Suspended phase, no ticks fire (trivially, by definition).
Therefore, CPU_wakeups = 0. QED.
```

With event-driven schedules:

```
Proof: When schedule is empty AND no new input arrives, no ticks are enqueued.
Need to prove that schedule generator produces finite schedule (non-obvious!).
Need to prove that schedule completion can be detected (epsilon problem!).
Need to prove that interruptions don't create phantom ticks (schedule merging!).
```

The suspend/resume proof is shorter and carries fewer premises.

---

## Why Fixed Timestep Wins in Formal Methods

From my domain's perspective, the decisive reasons are:

### 1. Temporal Coordinates are Explicit

Fixed timestep makes time an explicit, first-class ledger object. The tick index is the temporal coordinate. This is foundational for formal reasoning about temporal systems.

Event-driven systems make time implicit in event ordering. This works operationally but creates verification challenges: you must prove that event ordering respects causality, which requires reasoning about both the event stream and the scheduler's decisions.

### 2. No Floating-Point Accumulation in Time

With fixed timestep:

```
time_at(tick_n) = n * Δt

This is exact integer arithmetic. No accumulated rounding error.
```

With event-driven scheduling:

```
timestamp = computed from velocity decay exponentials
timestamp = previousTimestamp + delay_from_schedule
This accumulates floating-point error over many computations.
```

Formal verification of numerical code is hard. Fixed timestep eliminates half the problem (time is exact).

### 3. Interrupt Semantics Are Simple

Fixed timestep: inputs are queued, all inputs processed in tick order. No interruption logic.

Event-driven: schedules can be interrupted, requiring cancel/merge logic. This creates new proof obligations.

### 4. Suspension/Resume is a Total State Transition

When the system suspends, the transition is atomic and deterministic:

```
Theorem: Suspension always occurs when: velocity < EPSILON AND inputQueue.isEmpty()
This is a decidable property of the state machine.
```

Pre-computed schedules don't have this property. The decision to proceed with a schedule vs. interrupt it is only checkable post-hoc.

---

## My Final Recommendation

**Adopt Fixed Timestep with Suspend/Resume.**

Here is my recommended formal specification:

### Temporal Model

```typescript
// Tick index is the primary temporal coordinate
type Tick = ℕ (non-negative integer)

// System has two execution phases
enum Phase { Active, Suspended }

// Ledger entries include phase information
type LedgerEntry =
  | { tick: Tick, phase: 'active', rules: Rule[] }
  | { tick: Tick, phase: 'active_to_suspended' }
  | { tick: Tick, phase: 'suspended_to_active', input: Input }

// Determinism specification
Specification DeterministicReplay {
  ∀ ledger_entries, state_0:
    Let state_n = apply(state_0, ledger_entries)
    Then: replay(state_0, ledger_entries) = state_n

  Where apply is pure: same input always produces same output
}

// Temporal specification
Specification MonotonicTime {
  ∀ i, j: ledger_entries[i].tick < ledger_entries[j].tick
    OR ledger_entries[i].tick = ledger_entries[j].tick (same suspension boundary)
}

// Efficiency specification
Specification EffectiveIdleSuspension {
  ∀ period [t1, t2] where:
    ∧ velocity < EPSILON
    ∧ inputQueue.isEmpty
    ∧ !scheduledRules
  Then:
    ∧ CPU_wakeups_in_period = 0
    ∧ Ledger_entries_in_period < 2 (only suspend/resume boundaries)
}

// Provenance specification
Specification ExplicitCausality {
  ∀ state change in ledger:
    ∃ explicit ledger entry that caused it (rule application, input, or phase transition)
}
```

### Implementation Guidelines (for verification)

```typescript
// The main loop must be provably correct
Algorithm ReplayKernel(ledger: LedgerEntry[]): State {
  state = initialState
  tick = 0
  phase = Active

  for entry in ledger {
    // Verify monotonic tick ordering
    assert(entry.tick >= tick)

    // Handle phase transitions
    if entry.phase = 'active_to_suspended' {
      // Verify suspension condition was true
      assert(velocity(state) < EPSILON)
      assert(inputQueue.isEmpty)
      phase = Suspended
      tick = entry.tick
    } else if entry.phase = 'suspended_to_active' {
      // Verify we had an input
      assert(entry.input ≠ null)
      tick = entry.tick + 1
      state = applyRule(state, entry.input)
      phase = Active
    } else {
      // Normal tick
      assert(phase = Active)
      tick += 1
      state = applyRules(state, entry.rules)
    }
  }

  return state
}

// Proof of correctness
Theorem ReplayKernelCorrectness:
  ∀ ledger satisfying MonotonicTime and ExplicitCausality:
    ReplayKernel(ledger) = compute(initialState, ledger)
```

### Why This Passes Formal Verification

1. **Temporal coordinates are explicit integers**: No floating-point accumulation
2. **Phase transitions are observable in ledger**: No hidden state
3. **All proofs are over decidable properties**: Tick indices, rule applications, state values
4. **Composition works**: Proofs of individual rules compose into proof of system
5. **Interrupt handling is unnecessary**: The state machine handles it naturally

---

## Limitations and Caveats

I must acknowledge what formal methods cannot address:

### 1. Distributed Consensus is Needed

Suspend/resume requires that all replicas agree on when suspension occurs. This requires consensus:

```
Problem: Replica A suspends after tick 1000, Replica B after tick 1001
         (due to different floating-point rounding in velocity < EPSILON check)

Solution: Make suspension a consensus decision
         Both replicas propose suspension, commit to ledger, then suspend
         This adds latency but preserves correctness
```

This is a distributed systems problem (Expert 001's domain), not a formal verification problem.

### 2. Specification Completeness

The specifications I gave above assume:

- `velocity < EPSILON` is computable (it is)
- Ledger entries can be serialized deterministically (they can be)
- All replicas use same Δt and EPSILON values (they must)

If these assumptions are violated, the formal guarantees break. This is a deployment and configuration concern, not a technical one.

### 3. Formal Verification Overhead

Actually proving the ReplayKernel theorem requires:

- A theorem prover (Coq, Isabelle, Lean)
- Formal specifications of all rule implementations
- Proof of all arithmetic properties
- Possibly 10-100x the code in proofs vs. implementation

This is only worthwhile for critical systems. For WARP, we might use formal methods for specification (as I've provided above) but not full mechanical verification.

---

## Summary of My Position Evolution

**Opening:** I was optimistic about pure event-driven systems, believing that causality tracking could solve determinism without explicit temporal quantization.

**Round 1:** I proposed pre-computed deterministic schedules as a hybrid approach—achieving numerical stability while preserving event-driven efficiency.

**Round 2:** I recognized that pre-computed schedules fail on rigorous grounds (interrupt semantics, checksum verification surface, epsilon relocation).

**Final:** I now recommend fixed timestep with suspend/resume because it is the only approach that satisfies my domain's requirements for formal verification:

1. Explicit temporal coordinates (no derived timestamps)
2. Strong determinism (works on any machine, any compiler)
3. Formal compositionality (proofs of parts combine into proofs of whole)
4. Clear causality (every state change has an explicit ledger entry)
5. Minimal proof burden (simplest specifications to verify)

---

## Final Vote

**Primary Recommendation:** Option A (Fixed Timestep with Suspend/Resume)

**Confidence:** 95%

**Rationale:** This is the only architecture that satisfies formal methods requirements for deterministic, provenance-tracked systems with temporal reasoning.

**Dissenting Preference:** If the team decides that implementation simplicity trumps verification rigor, Option B (pure event-driven with pre-computed schedules) is a credible alternative, provided:

1. Schedule interruption semantics are formally specified upfront
2. All platforms converge to identical schedule lengths (prove epsilon behavior)
3. Scheduler determinism is formally verified (non-trivial)

But this path accepts higher verification burden for lower efficiency gain. Not recommended from my domain.

---

**Signature:** Expert 004
**Domain:** Formal Methods, Provenance Tracking, Correctness Proofs, Deterministic Guarantees, Formal Verification
**Confidence:** 95% (high confidence in suspend/resume being formally superior; some uncertainty about whether the team will prioritize formal verification over implementation convenience)
**Key Insight:** In provenance-tracked systems, the temporal coordinate is not a performance optimization—it is a formal object that must be explicit in the ledger. This principle alone determines the architecture.
