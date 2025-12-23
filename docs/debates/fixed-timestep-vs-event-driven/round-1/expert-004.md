# Round 1 Response: Expert 004

## Domain: Formal Methods, Provenance Tracking, Correctness Proofs

**Date**: 2025-12-20
**Phase**: Round 1

---

## My Perspective

After reviewing all opening statements, I must acknowledge that Expert 001 and Expert 003 have surfaced a critical formal property I initially underweighted: **numerical stability under variable timesteps**.

However, I maintain that the event-driven approach is superior for provenance tracking, and the numerical stability concern can be addressed without adopting fixed timesteps.

### Conceding Ground: The Numerical Stability Argument

Expert 001's equation deserves careful analysis:

```
velocity(t+Δt) = velocity(t) * damping_factor^Δt
position(t+Δt) = position(t) + velocity(t) * Δt
```

Expert 003 correctly identifies that variable Δt creates different numerical paths. This is a genuine problem for deterministic replay **if we compute damping per-tick with variable intervals**.

**However**, this assumes an imperative integration model. There is an alternative that preserves event-driven ticks while eliminating floating-point drift.

### Counter-Proposal: Pre-computed Deterministic Schedules

The key insight: **damping schedules can be computed once and committed to the ledger atomically**.

When a pan gesture starts with initial velocity v₀, we don't schedule "apply damping each tick." Instead, we compute the entire decay sequence:

```typescript
function computeDampingSchedule(v0: Vec2, dampingFactor: number): Schedule {
  const ticks: Array<{ delay: number; velocity: Vec2 }> = [];
  let v = v0;
  let t = 0;

  while (v.magnitude() > EPSILON) {
    t += TICK_DELTA; // Fixed interval for numerical stability
    v = v.multiply(Math.pow(dampingFactor, TICK_DELTA));
    ticks.push({ delay: t, velocity: v });
  }

  return {
    type: 'DampingSchedule',
    ticks,
    checksum: hash(ticks) // Deterministic verification
  };
}
```

The ledger records:

```
Receipt[42]: PanStart(v0=[10,5])
  → Scheduled 23 continuation ticks with checksum 0xABCD1234
Receipt[43]: PanContinue(v=[9.8, 4.9])  // Fires 16.67ms later
Receipt[44]: PanContinue(v=[9.6, 4.8])  // Fires 16.67ms later
...
```

**Formal properties this achieves:**

1. **Deterministic computation**: The schedule is computed once using IEEE 754 math, producing bit-identical results across platforms
2. **Verifiable schedule**: The checksum allows proof that replay followed the correct sequence
3. **Event-driven efficiency**: No ticks fire when camera is at rest
4. **Numerical stability**: Each damping step uses the same Δt, eliminating accumulation drift

This **combines** Expert 003's numerical correctness with Expert 002's efficiency gains.

### Rebuttal to Expert 001: Time as Input vs Time as Metadata

Expert 001 claims "time must be explicitly modeled as an input" for state machine replication. I disagree with the framing.

**Time is not an input—time is metadata about when inputs arrive.**

Consider a classic state machine:

```
State × Input → State
```

In fixed timestep, we're forced to write:

```
State × (Input ∪ {TickElapsed}) → State
```

This conflates "an event happened" with "time passed." The ledger fills with `TickElapsed` pseudo-events that carry no information.

**The core question**: Is "no event occurred" a fact worth recording?

From a provenance perspective, **no**. Provenance asks "what caused this state?" not "what didn't cause this state?"

Expert 001's "empty tick cost" analysis (1-2 bytes per tick) understates the formal verification burden. Each empty tick is a proof obligation: "verify that applying no-op at tick N preserves state." At 60Hz over hours, this is millions of trivial proofs obscuring the actual causal chain.

### Addressing Expert 003: The Game Engine Precedent

Expert 003 provides valuable empirical evidence from game engine architecture. However, there's a critical disanalogy between game physics and WARP rules:

**Game engines use fixed timestep because:**

1. Physics solvers (rigid body dynamics, collision detection) are iterative numerical methods
2. Variable Δt causes instability in constraint solvers (joints, contacts)
3. Multiplayer requires lockstep simulation across clients

**WARP's rule system differs:**

1. Rules are discrete graph transformations, not numerical integration
2. Camera damping is the **only** continuous behavior (currently)
3. No multiplayer synchronization (single-user provenance)

The physics engine analogy is not dispositive. We're not building Unreal Engine—we're building a deterministic rule application system with one special case (inertia).

### Synthesis with Expert 002: Performance Meets Correctness

Expert 002's performance analysis is compelling. The modal use case—idle periods—is precisely when provenance overhead matters most.

Consider a debugging scenario:

```
User: "Why did this node expand?"
System: "Analyzing ledger... processing 3,600 empty ticks... processing 3,600 empty ticks... found: Receipt[9843] at tick 9843"
```

Compare to:

```
User: "Why did this node expand?"
System: "Receipt[42]: ExpandNode triggered by UserClick"
```

Provenance is about causality, and **empty ticks obscure causality**.

### Agreement with Expert 005: Architectural Honesty

Expert 005 frames this correctly: "what is the ledger for?"

If the ledger is a **proof of computation**, it should record computations, not clock ticks.

The proposed "Option 3: Event-Driven with Scheduled Physics" aligns with my revised position: handle inertia via pre-computed deterministic schedules, keep the ledger causal.

### Revised Formal Position

I withdraw my claim that "inertia is a scheduled future input" without qualification. Expert 001 and 003 are correct that variable-Δt integration is problematic.

**However**, I maintain that:

1. Fixed-Δt integration can occur within an event-driven tick model
2. Schedules should be computed atomically and verified with checksums
3. The ledger should record only meaningful state changes, not time passage
4. Provenance verification complexity should scale with events, not time

This is **not** hybrid (two separate clocks). This is **event-driven ticks with deterministic scheduling primitives**.

## Extension Vote

**Continue Debate**: YES

**Reason**: Expert 001 and Expert 003 have raised numerical stability concerns that require deeper examination. My pre-computed schedule proposal needs peer review to ensure it actually solves the determinism problem without introducing new edge cases. We should debate:

1. Whether pre-computed schedules are equivalent to fixed timestep for numerical purposes
2. What happens when schedules are interrupted (e.g., user inputs during damping)
3. Whether the scheduling complexity is worth the provenance benefits

## Proposed Voting Options

Based on this round, I propose refining the options to distinguish **tick model** from **integration strategy**:

### Primary Vote: Tick Trigger Model

- **Option A**: Fixed timestep - tick fires every Δt regardless of inputs
- **Option B**: Event-driven - tick fires only when inputs/schedules exist
- **Option C**: Hybrid - fixed when active, event-driven when idle

### Secondary Vote: Continuous Behavior Integration (if Option B or C wins)

- **Option B1**: Self-scheduling with variable Δt (my original proposal - now rejected)
- **Option B2**: Pre-computed schedules with fixed Δt (my revised proposal)
- **Option B3**: Tick pooling (batch multiple scheduled events at Δt boundaries)

### Tertiary Vote: Ledger Storage Optimization (if Option A wins)

- **Option A1**: Store every tick literally
- **Option A2**: Run-length encode empty ticks
- **Option A3**: Store tick range with "no inputs" marker

This framing separates the concerns: How do ticks fire? How is physics computed? How is the ledger stored?

---

## Key Questions for Next Round

1. **To Expert 001**: Does my pre-computed schedule proposal satisfy your determinism requirements, or does it still have hidden non-determinism?

2. **To Expert 002**: What is the actual performance cost of the scheduling infrastructure needed for pre-computed continuations?

3. **To Expert 003**: Can you identify failure modes in the pre-computed schedule approach that fixed timestep avoids?

4. **To Expert 005**: Is "pre-computed deterministic schedules" a clean architectural abstraction or an ad-hoc hack?

---

**Expert 004**
_Formal Methods & Correctness Proofs_

**Status**: Revised position based on peer input. Maintaining event-driven preference but acknowledging numerical stability constraints.
