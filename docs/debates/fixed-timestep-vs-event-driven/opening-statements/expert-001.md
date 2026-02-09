# Expert 001: Opening Statement

## Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Expert ID:** 001
**Domain:** Distributed systems, determinism, replay guarantees, consensus mechanisms, state machine replication
**Phase:** Opening Statement
**Date:** 2025-12-20

---

## Position: STRONGLY FAVOR FIXED TIMESTEP

### Core Argument

From a distributed systems perspective, **fixed timestep is the only architecturally sound choice** for a deterministic, replay-capable system with continuous behaviors like inertia. This is not merely a preference—it's a fundamental requirement that emerges from the mathematics of state machine replication.

### Key Reasoning

#### 1. Determinism Requires Temporal Quantization

In state machine replication theory, determinism demands that:

- State transitions are pure functions of (previous_state, input, time)
- Time must be explicitly modeled as an input
- External sources of non-determinism must be eliminated

**Fixed timestep achieves this** by making time itself part of the deterministic state machine. Each tick advances by exactly Δt, making the temporal coordinate as deterministic as any other state variable.

**Event-driven scheduling fails** because it couples state evolution to:

- When inputs arrive (network-dependent)
- When "continuous behaviors schedule their own ticks" (non-deterministic unless tick scheduling is itself logged)
- External wall-clock time (fundamentally non-deterministic)

#### 2. Continuous Behaviors Demand Regular Sampling

The presence of camera inertia (velocity damping) is the smoking gun. Consider the physics:

```
velocity(t+Δt) = velocity(t) * damping_factor^Δt
position(t+Δt) = position(t) + velocity(t) * Δt
```

**Event-driven approach creates an impossible problem:**

- If no input arrives, when does the next tick occur?
- If the system schedules its own tick, that scheduling decision must be in the ledger
- But the ledger only contains "what happened," not "when to wake up next"
- Replay would require re-deriving wake-up times from state, which is:
  - Computationally expensive
  - Prone to floating-point drift
  - Architecturally backwards (ledger should be source of truth, not derived)

**Fixed timestep eliminates this entirely:**

- Tick N always occurs at time N \* Δt
- Replay simply iterates: for tick in 0..last_tick
- No scheduling metadata needed in ledger
- Temporal coordinate is implicit in tick index

#### 3. Ledger Design and Replay Guarantees

From a consensus perspective, the ledger must be **minimal and self-contained**:

**Fixed Timestep Ledger:**

```
Tick 0: [rule_proposals]
Tick 1: [rule_proposals]
Tick 2: []  // No input, but still a tick
Tick 3: [rule_proposals]
```

- Each entry is state delta
- Tick index implies absolute time
- Replay: deterministically apply deltas in order
- Verification: hash(state_N) = hash(apply(state_0, ticks_0..N))

**Event-Driven Ledger (attempt):**

```
Entry 0: timestamp=0.000, [rules]
Entry 1: timestamp=0.016, [rules]  // Input arrived
Entry 2: timestamp=0.087, [rules]  // System scheduled for inertia update
Entry 3: timestamp=0.105, [rules]  // Another input
```

- Requires explicit timestamps (more data)
- Timestamps must be deterministically derived (how?)
- "System scheduled" entries are metadata pollution
- Replay must interpret scheduling logic, not just apply deltas
- Non-uniform temporal sampling complicates interpolation

#### 4. Separation of Concerns

A critical architectural insight: **rendering is separate from state evolution**.

This means:

- State evolution can run at fixed 60 Hz (or any rate)
- Rendering can run at variable refresh rate (VSync, 120Hz, etc.)
- Rendering interpolates between ticks if needed

**This is the solution used by:**

- Source engine (Valve)
- Unity's FixedUpdate
- Multiplayer game engines universally
- Real-time operating systems

The pattern exists because it's mathematically correct: you **cannot** have deterministic continuous behaviors without regular temporal sampling.

#### 5. Addressing the "Ledger Size" Concern

The objection that fixed timestep creates "empty ticks" in the ledger is a **false economy**:

**Empty tick cost:**

- Tick index (implicit, zero bytes)
- Empty rule list (1-2 bytes)
- Marginal storage cost: ~0.1 KB/sec at 60Hz

**Event-driven tick cost:**

- Explicit timestamp (8 bytes minimum)
- Scheduling metadata (type: input vs scheduled)
- Complex replay logic
- Risk of non-determinism bugs
- Ongoing maintenance burden

Storage is cheap. Determinism bugs are expensive. This is not a trade-off.

### Proposed Resolution

**Primary Vote:**

- Option A: Fixed timestep with Δt = 1/60 sec (16.67ms)
- Option B: Event-driven with continuous behaviors scheduling ticks
- Option C: Hybrid (fixed timestep for physics, event-driven for discrete inputs)

**Secondary Parameters (if Option A wins):**

- Tick rate: 60 Hz vs 120 Hz vs configurable
- Empty tick optimization: store run-length encoding vs always store
- Timestamp alignment: align to Unix epoch vs relative to session start

### Anticipated Counter-Arguments

**"Empty ticks waste space"**
Response: Minimal cost, eliminates entire class of bugs. Compression handles this trivially.

**"Event-driven is more efficient"**
Response: Efficiency at the cost of correctness is not efficiency. Determinism is non-negotiable.

**"We can make event-driven deterministic by logging timestamps"**
Response: Then you've reinvented fixed timestep with extra steps. Why not use the simpler design?

**"Hybrid approach: fixed for physics, event for discrete"**
Response: This creates two separate temporal domains, complicating synchronization. If you need fixed timestep anyway, extend it to everything.

---

## Conclusion

From a distributed systems perspective, this debate has a clear answer: **fixed timestep is the only principled choice**. The presence of continuous behaviors (inertia) mathematically requires regular temporal sampling, and deterministic replay demands that this sampling be part of the state machine itself, not an external scheduling concern.

Event-driven ticks are appropriate for purely discrete systems (e.g., workflow engines, message processors). But the moment you introduce continuous state evolution, you've left the realm where event-driven architectures are sound.

**Expert 001 recommends: Fixed timestep at 60 Hz with run-length encoding for empty ticks.**

---

**Signature:** Expert 001
**Confidence:** 95% (very high confidence in fixed timestep; slight uncertainty about optimal tick rate)
**Key Risk:** If I've misunderstood the inertia model (e.g., if it's not truly continuous), conclusion might need revision.
