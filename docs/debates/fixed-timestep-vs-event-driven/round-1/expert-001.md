# Expert 001: Round 1 Response

## Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Expert ID:** 001
**Domain:** Distributed systems, determinism, replay guarantees, consensus mechanisms, state machine replication
**Phase:** Round 1
**Date:** 2025-12-20

---

## My Perspective

After reviewing all opening statements, I find the debate more nuanced than my initial position suggested, but I remain convinced that **fixed timestep is the correct architectural choice**—though Experts 004 and 005 have surfaced important design constraints that must be addressed.

### Acknowledging Valid Concerns

**Expert 002's performance arguments are well-taken but overstate the costs:**

The idle-time overhead concern is real, but the solution is not event-driven—it's **run-length encoding at the storage layer** (as Expert 003 correctly suggests). The logical model should remain "every tick exists" while the physical representation compresses idle periods. This preserves determinism while achieving the storage efficiency Expert 002 demands.

Regarding "replay latency": processing 216,000 empty ticks is trivial—modern CPUs execute billions of instructions per second. The real cost is I/O, which compression solves.

**Expert 004's causality argument contains a subtle error:**

The claim that "event-driven preserves input causality" conflates two different concerns:

1. **Logical causality**: What caused what?
2. **Temporal quantization**: When did it happen?

Event-driven scheduling does not eliminate the need for temporal quantization—it merely moves it from the kernel to the scheduler. Consider Expert 004's inertia example:

```
Input[t0]: PanStart schedules Input[t1], Input[t2], ..., Input[tn]
```

This requires the scheduler to compute exact timestamps for t1, t2, etc. Those timestamps must be:

- Deterministically derived
- Stored in the ledger (otherwise replay cannot reconstruct them)
- Immune to floating-point drift

**This is fixed timestep with extra steps.** The scheduler is computing: `t_i = t_0 + i * Δt` for some Δt. Why not make that explicit?

**Expert 005 correctly identifies the central architectural question:**

> "Where we want complexity to live"

This is the right framing. Both approaches can achieve determinism, but they distribute verification burden differently.

### The Core Distributed Systems Argument

From my domain (distributed systems), the critical insight is this: **deterministic replay is a state machine replication problem**.

In state machine replication theory, the fundamental theorem is:

```
∀ replicas R, if R processes inputs in same order → R converges to same state
```

But this requires a **total order on inputs**. In a distributed system with continuous behaviors, time itself is an input. How do we establish total order on time?

**Fixed Timestep Solution:**

- Time is quantized to tick indices: T = {0, 1, 2, ...}
- Total order is trivial: integer sequence
- Consensus on "what happened at tick N" is well-defined
- Replay: `state_N = fold(apply, state_0, inputs_0..N)`

**Event-Driven Solution (as proposed by Expert 004):**

- Scheduler computes timestamps for continuous behaviors
- Those timestamps must be in ledger (otherwise non-deterministic)
- Replay must reconstruct scheduler decisions from logged timestamps
- Consensus on "what happened" requires agreeing on scheduling logic

The event-driven approach makes **the scheduler part of the consensus protocol**. This is not necessarily wrong, but it's architecturally heavier than it appears.

### Responding to Specific Arguments

**To Expert 002 (Performance):**

Your modal use case analysis assumes the system is idle most of the time. But consider:

- Idle periods compress to near-zero storage cost (run-length encoding)
- Active periods (your "smooth pan") show no difference between approaches
- Background tabs should suspend entirely (don't run kernel at all)

The performance delta in realistic scenarios is negligible, while the determinism risk in event-driven is real.

**To Expert 003 (Game Engines):**

Your implementation note about compression is exactly right. This should be the default strategy: fixed timestep for logical correctness, compression for physical efficiency.

**To Expert 004 (Formal Methods):**

Your proof complexity comparison is compelling, but it assumes that event-driven scheduling is "given" as deterministic. In reality, proving the scheduler is deterministic adds complexity:

```
∀ state S, ∀ input I:
  schedule(S, I) = deterministic list of (timestamp, rule) pairs
```

This proof obligation is non-trivial when continuous behaviors self-schedule. You must prove:

- No floating-point non-determinism
- No platform-dependent scheduling
- No race conditions in priority queue
- Convergence (inertia eventually stops scheduling)

Fixed timestep eliminates these proof obligations by making time an explicit parameter.

**To Expert 005 (Architecture):**

Your question about ledger philosophy is incisive: "proof of computation vs replayable timeline?"

I argue these are not in tension. A replayable timeline **is** a proof of computation. The ledger proves: "If you execute these inputs at these times, you get this state." The temporal dimension is part of the proof.

### Refined Position

My opening statement was too dismissive of the "empty tick cost." Experts 002 and 004 are right that a ledger filled with no-ops is aesthetically and practically problematic.

**However**, the solution is not to abandon fixed timestep—it's to separate the logical model from the physical representation:

**Logical Model (Determinism Layer):**

- Fixed timestep at Δt = 16.67ms (60 Hz)
- Every tick exists conceptually
- Replay processes tick 0, 1, 2, ..., N in sequence

**Physical Representation (Storage Layer):**

- Run-length encode idle periods: `{start_tick: 1000, end_tick: 5000, rules: []}`
- Compress repeated patterns
- On replay, decompress to logical model

This gives us:

- Fixed timestep's determinism guarantees
- Event-driven's storage efficiency
- Clear separation of concerns

### Critical Question for Event-Driven Advocates

If event-driven scheduling is deterministic, you must answer: **what generates the timestamps for scheduled rules?**

- If it's wall-clock time → non-deterministic (network delays, system load)
- If it's computed from state → must be pure function, must be logged
- If it's logged → ledger contains timestamp stream → equivalent to fixed timestep

I have not seen a satisfactory answer to this in the opposing arguments.

## Extension Vote

**Continue Debate**: YES

**Reason**: Expert 004's formal methods perspective has surfaced proof complexity concerns that deserve deeper exploration. Specifically, can we formalize the determinism guarantees of event-driven scheduling in a way that is verifiably simpler than fixed timestep? If yes, my position may need revision.

Additionally, Expert 005's "hybrid" suggestions deserve consideration. Perhaps there is a middle ground that satisfies both camps.

## Proposed Voting Options

I refine my original options based on this round:

### Primary Architecture Decision

**Option A: Fixed Timestep with Compression (RECOMMENDED)**

- Logical: Fixed 60 Hz tick, every tick conceptually exists
- Physical: Run-length encode idle periods in storage
- Replay: Decompress to logical ticks, process sequentially
- Determinism: Trivial (tick count is clock)
- Storage: O(events) after compression

**Option B: Event-Driven with Logged Scheduling**

- Ticks fire only when inputs or scheduled rules exist
- Scheduler must log all computed timestamps
- Replay: Reconstruct scheduler state from logged timestamps
- Determinism: Depends on scheduler determinism proof
- Storage: O(events) natively

**Option C: Hybrid with Mode Switching**

- Fixed timestep when continuous behaviors active
- Event-driven when fully idle (no motion, no pending rules)
- Mode switch logged in ledger
- Determinism: Moderate complexity (two modes to prove)
- Storage: Between A and B

### Secondary Parameters (if Option A wins)

1. **Tick Rate**: 60 Hz (recommended) vs 120 Hz vs configurable
2. **Compression Strategy**: Always compress vs lazy compression vs user-configurable
3. **Idle Detection**: Explicit "pause" command vs automatic vs never pause

### Questions for Final Round

If we proceed to finals, I propose these questions be addressed:

1. **For event-driven advocates**: Provide concrete pseudocode for deterministic inertia scheduling, including timestamp computation and ledger format.

2. **For fixed timestep advocates** (including me): Provide storage cost analysis with realistic compression ratios.

3. **For all**: Should we prototype both and measure actual performance/determinism trade-offs?

---

**Signature:** Expert 001
**Confidence:** 85% (high confidence in fixed timestep as logical model; moderate uncertainty about whether event-driven with logged scheduling could achieve equivalent guarantees)
**Key Revision:** Now acknowledge that storage-layer compression is mandatory, not optional, making the "empty tick cost" argument much weaker.
