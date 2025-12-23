# Expert 001: Round 2 Response

## Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Expert ID:** 001
**Domain:** Distributed systems, determinism, replay guarantees, consensus mechanisms, state machine replication
**Phase:** Round 2
**Date:** 2025-12-20

---

## My Perspective

Round 1 has crystallized the debate wonderfully. Expert 005's insight that "we're debating different problems" is exactly right. Two concrete proposals have emerged that demand careful analysis:

1. **Expert 004's "pre-computed deterministic schedules"** - an attempt to preserve event-driven efficiency while achieving numerical stability
2. **Expert 005's "fixed timestep with suspend/resume"** - an attempt to preserve fixed timestep determinism while addressing idle overhead

These represent the most intellectually honest attempts to bridge the camps. Let me evaluate both through the lens of distributed systems correctness.

### Critical Analysis: Expert 004's Pre-Computed Schedules

Expert 004's revised position acknowledges numerical stability concerns while attempting to preserve event-driven ticks. The proposed solution:

```typescript
function computeDampingSchedule(v0: Vec2, dampingFactor: number): Schedule {
  const ticks: Array<{ delay: number; velocity: Vec2 }> = [];
  let v = v0;
  let t = 0;

  while (v.magnitude() > EPSILON) {
    t += TICK_DELTA; // Fixed interval
    v = v.multiply(Math.pow(dampingFactor, TICK_DELTA));
    ticks.push({ delay: t, velocity: v });
  }

  return { type: 'DampingSchedule', ticks, checksum: hash(ticks) };
}
```

**This is brilliant, but it has a fatal flaw: interrupt semantics.**

Consider what happens when a pre-computed schedule is interrupted:

```
t=0: PanStart(v0=[10,5]) computes 23-tick schedule → checksum 0xABCD
t=16ms: Tick 1 fires → v=[9.8, 4.9]
t=33ms: Tick 2 fires → v=[9.6, 4.8]
t=50ms: USER CLICKS (new input arrives)
```

**What happens at t=50ms?**

**Option 1: Cancel schedule, recompute**

- Violates the checksum (ledger said 23 ticks, but only 3 occurred)
- Ledger must record "schedule interrupted at tick 3"
- On replay, must reconstruct: when did interruption occur?
- This reintroduces wall-clock dependency (interruption time is non-deterministic)

**Option 2: Let schedule complete, queue input**

- User input delayed until inertia finishes (unacceptable UX)
- 23 ticks @ 16.67ms = 383ms of unresponsiveness

**Option 3: Process input immediately, schedule continues in parallel**

- Now you have concurrent scheduled events (damping) and discrete events (click)
- Must define priority/ordering semantics when they collide
- This is the "hybrid complexity" Expert 003 warned about

**The deeper problem:** Pre-computed schedules assume **closed-world continuations**. They work when a behavior runs to completion without interruption. But user input is **open-world**—it can arrive at any time.

From a distributed systems perspective, this is the difference between:

- **Batch processing**: Compute entire schedule upfront (Expert 004's model)
- **Stream processing**: Handle events as they arrive (fixed timestep model)

User interaction is fundamentally stream-like, not batch-like.

### Critical Analysis: Expert 005's Suspend/Resume Pattern

Expert 005 proposes a more pragmatic solution:

```typescript
enum KernelState {
  Active,
  Suspended
}

function shouldSuspend(state: State): boolean {
  return !state.camera.hasVelocity && !state.hasScheduledRules && inputQueue.isEmpty();
}
```

With ledger entries:

```
Tick 1000: [rules...]
Tick 1002: [suspend] // Camera stopped
// (no CPU usage)
Tick 1003: [resume]  // User clicked
```

**This is much closer to correct**, but still has subtle issues:

**Issue 1: Suspend is not deterministic without wall-clock**

When does tick 1003 occur? If it's "when user clicks," then the tick index is determined by wall-clock time between suspend and resume. Two replays with different suspension durations would have:

```
Replay 1: suspend at tick 1002, resume at tick 1003 (1 tick gap)
Replay 2: suspend at tick 1002, resume at tick 50000 (48998 tick gap)
```

These produce different tick indices for the same logical event sequence.

**The fix:** Suspend/resume must **not** advance the tick counter. Instead:

```
Tick 1000: [rules...]
Tick 1001: [rules...]
Tick 1002: [suspend]
Tick 1002: [resume, input=Click] // Same tick index!
Tick 1003: [rules...]
```

During suspension, the tick counter **freezes**. Resume occurs "at the same tick" that suspended. This preserves deterministic tick indices.

**Issue 2: Distributed consensus on suspension**

In a multi-replica setting (future-proofing for collaboration), replicas must agree on when to suspend. Consider:

- Replica A: Last rule processed at tick 1000, suspends at tick 1002
- Replica B: Slightly slower, last rule processed at tick 1000, suspends at tick 1005

If suspension decision is local (based on "no more work"), replicas diverge.

**The fix:** Suspension must be a **committed decision** in the ledger, not a local optimization. This adds latency (must commit before suspending) but preserves correctness.

### Refined Position: Fixed Timestep with Committed Suspension

Integrating Expert 005's insight with distributed systems correctness requirements, I propose:

**Logical Model:**

- Fixed timestep at 60 Hz when active
- Tick index is the authoritative clock
- Every tick conceptually exists (even if empty)

**Execution Model:**

- Active: Tick fires every 16.67ms
- When no pending rules and no velocity: **propose** suspension to ledger
- On ledger commit: enter suspended state, freeze tick counter
- On input arrival: propose resume to ledger
- On ledger commit: wake from suspension, continue from frozen tick

**Ledger Format:**

```
Tick 1000: [PanStart(v0=[10,5])]
Tick 1001: [PanContinue(v=[9.8, 4.9])]
...
Tick 1023: [PanStop]
Tick 1024: [SuspendProposed]
Tick 1025: [SuspendCommitted] // Kernel sleeps, tick counter frozen
// (arbitrary wall-clock time passes)
Tick 1025: [ResumeProposed(input=Click)] // Same tick!
Tick 1026: [ResumeCommitted, ExpandNode]
Tick 1027: [rules...]
```

**This achieves:**

- Fixed timestep determinism (tick index never depends on wall-clock)
- Zero CPU usage during idle (Expert 002's performance requirement)
- Explicit provenance (suspension is a first-class event, Expert 004's requirement)
- Distributed correctness (suspension is committed, not local)

### Response to Specific Round 1 Arguments

**To Expert 002 (Performance):**

You win on the idle overhead argument—but the solution is not event-driven, it's **suspension as a first-class ledger event**. This gives you zero CPU wakeups during idle while preserving deterministic tick indices.

Your claim that "run-length encoding doesn't eliminate replay work" is incorrect for the suspension model. During suspension, replay doesn't process ticks at all—it jumps directly from `SuspendCommitted` to `ResumeProposed`.

**To Expert 003 (Game Engines):**

Your convergence concern for Expert 002's self-scheduling pattern is exactly right. The epsilon threshold for "motion stopped" is arbitrary and affects determinism.

With suspend/resume, we avoid this: the kernel continues ticking until velocity is **exactly zero** (not epsilon-close). Then explicit suspension occurs. No arbitrary thresholds.

**To Expert 004 (Formal Methods):**

Your pre-computed schedule proposal is creative, but I've shown above that it breaks on interruption. The fundamental issue: you're trying to make **continuation-passing style** work in an **interactive system**.

However, your core critique remains valid: "empty ticks obscure causality." The suspend/resume pattern addresses this—suspension periods are explicit, not a stream of empty ticks.

**To Expert 005 (Architecture):**

Your framing of "WARP's core identity" is incisive. I agree WARP is fundamentally a **temporal state machine**, not just a rule system. Time is a first-class dimension.

Your suspend/resume pattern is the right direction, but needs the refinement I outlined above (frozen tick counter, committed suspension) to be truly deterministic.

### The Distributed Systems Perspective on Pre-Computation

Let me address Expert 004's approach from my domain:

In distributed systems, we distinguish:

- **Eager scheduling**: Compute full schedule upfront (batch)
- **Lazy scheduling**: Compute next event when needed (stream)

Expert 004 proposes eager scheduling for inertia. This works in single-threaded simulations (games), but creates problems in interactive systems:

1. **Schedule invalidation**: User input during execution requires cancellation logic
2. **Schedule versioning**: Ledger must track which schedules are active/cancelled
3. **Replay complexity**: Must reconstruct schedule cancellation decisions

Fixed timestep is **implicitly lazy**: each tick computes only the next state. Schedules never need cancellation because they're never created.

This is why stream-processing systems (Kafka, Flink) use **micro-batching** instead of pre-computed schedules. You want small, interruptible units of work.

### Acknowledgment of Valid Concerns

I concede the following:

1. **Storage overhead of empty ticks is real** (Expert 002)
   - Solution: Suspend/resume, not event-driven ticks

2. **Provenance clarity matters** (Expert 004)
   - Solution: Suspension is explicit ledger event, not implicit gap

3. **Usage patterns matter** (Expert 003, Expert 005)
   - Solution: Profile real usage, but design for worst-case (continuous interaction)

4. **Idle CPU usage is unacceptable** (Expert 002)
   - Solution: Committed suspension with frozen tick counter

### Why Event-Driven Still Fails: The Timestamp Authority Problem

Despite Expert 004's best efforts, event-driven scheduling has an unresolved problem: **who assigns timestamps?**

Fixed timestep: Timestamp is tick index (monotonic integer)
Event-driven: Timestamp is... what?

Expert 004's schedule includes `{delay: number, velocity: Vec2}`. That `delay` is a timestamp. Where does it come from?

- If computed from state → must be pure, deterministic, platform-independent
- If derived from wall-clock → non-deterministic
- If logged explicitly → you're just encoding tick indices differently

**The fundamental theorem:** Any deterministic timestamp assignment is isomorphic to tick counting.

Event-driven advocates are trying to avoid "explicit" ticks while sneaking in "implicit" ticks via timestamps. But you can't escape temporal quantization in a discrete system.

## Extension Vote

**Continue Debate**: NO

**Reason**: Round 1 has converged on the technical solution: **fixed timestep with committed suspend/resume**. This satisfies all major concerns:

- Determinism (Expert 001): Tick index is authoritative, frozen during suspension
- Performance (Expert 002): Zero CPU during idle, explicit suspension
- Numerical stability (Expert 003): Fixed Δt for continuous behaviors
- Provenance (Expert 004): Suspension is first-class ledger event
- Pragmatism (Expert 005): Complexity lives in lifecycle management, not scheduling

The remaining questions are implementation details, not architectural choices. We should proceed to finals and vote.

## Proposed Final Voting Options

Based on Round 1 and 2 analysis:

### Primary Decision: Tick Model

**Option A: Fixed Timestep with Suspend/Resume (RECOMMENDED)**

- Fixed 60 Hz when active
- Explicit suspend/resume as ledger events
- Tick counter frozen during suspension
- Suspension requires ledger commit (distributed correctness)
- Storage: O(events) via suspension gaps
- CPU: Zero during suspension
- Determinism: Trivial (tick index is clock)

**Option B: Pure Event-Driven with Logged Scheduling**

- Ticks only when rules enqueued
- All timestamps logged explicitly
- Must solve interrupt semantics for schedules
- Must prove scheduler determinism
- Storage: O(events) natively
- CPU: Zero when idle
- Determinism: Depends on scheduler correctness proof

**Option C: Pre-Computed Schedules (Expert 004's Proposal)**

- Compute continuation schedules atomically
- Checksum verification
- Must define cancellation semantics
- Must handle concurrent schedules
- Storage: O(events)
- CPU: Variable (depends on schedule granularity)
- Determinism: Complex (schedule interruption edge cases)

### Secondary Parameters (if Option A wins)

1. **Suspension Policy**: Automatic (when idle) vs explicit (user command)
2. **Tick Rate**: 60 Hz (standard) vs 120 Hz (high-refresh) vs configurable
3. **Compression**: RLE for non-suspended empty ticks vs no compression

### Tertiary: Ledger Format Design

```typescript
type LedgerEntry =
  | { tick: number; rules: Rule[] } // Normal tick
  | { tick: number; suspend: true } // Kernel sleeps
  | { tick: number; resume: true; input: Input }; // Kernel wakes
```

## Final Architectural Recommendation

As the distributed systems expert, my final position:

**Adopt Option A: Fixed timestep with suspend/resume.**

This is the only approach that satisfies:

1. Deterministic replay (state machine replication)
2. Efficient idle behavior (performance)
3. Temporal queryability (provenance)
4. Distributed correctness (committed suspension)
5. Numerical stability (fixed Δt for physics)

Event-driven scheduling is an optimization, not an architecture. The optimization (don't tick when idle) can be achieved through suspension without abandoning the deterministic foundation of fixed timestep.

---

**Signature:** Expert 001
**Confidence:** 95% (high confidence in suspend/resume as the synthesis)
**Key Insight:** Suspension is not "pausing the tick stream"—it's an explicit state transition in the temporal state machine. This reframes the debate from "fixed vs event-driven" to "continuous vs suspended," which both camps can agree on.
