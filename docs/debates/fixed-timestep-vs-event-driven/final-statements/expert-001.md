# Expert 001: Final Statement

## Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Expert ID:** 001
**Domain:** Distributed systems, determinism, replay guarantees, consensus mechanisms, state machine replication
**Phase:** Final Statement
**Date:** 2025-12-20

---

## Final Recommendation

After three rounds of rigorous debate, I recommend **Fixed Timestep with Suspend/Resume** (Option C from Round 2).

This architecture combines the deterministic guarantees essential for distributed systems with the efficiency requirements for real-world deployment, while maintaining the architectural simplicity that makes correctness proofs tractable.

---

## Synthesis of Key Debate Insights

### 1. The Core Insight: Lifecycle Management vs. Scheduling Complexity

The breakthrough in this debate came from Expert 005's reframing in Round 1:

> "We're conflating two decisions: (1) When kernel is active, how do ticks work? (2) When should kernel suspend?"

This separated two orthogonal concerns that were being conflated:

- **Temporal semantics**: How time advances (fixed timestep)
- **Execution lifecycle**: When computation occurs (active vs. suspended)

By making this distinction, we discovered that the efficiency gains of event-driven scheduling can be achieved through explicit kernel lifecycle management, without the complexity of maintaining deterministic schedulers.

### 2. Pre-Computed Schedules: Sophisticated But Flawed

Expert 004's pre-computed deterministic schedules proposal was the most intellectually rigorous attempt to preserve event-driven semantics while achieving numerical stability:

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

**Why this fails from a distributed systems perspective:**

1. **It's fixed timestep in disguise**: The inner loop computes `t += TICK_DELTA`, which is exactly a fixed timestep simulation. The only difference is that it runs at schedule-generation time instead of execution time.

2. **Interruption semantics are unresolved**: When user input arrives during a pre-computed schedule, you need cancellation logic, partial schedule application, and ledger representation of "schedule interrupted at tick N of M." This is complex state management that fixed timestep avoids by making each tick independent.

3. **The epsilon problem remains**: The while-loop condition `v.magnitude() > EPSILON` is an arbitrary threshold that affects determinism. Different platforms or configurations might converge at different iterations due to floating-point semantics.

4. **Verification burden shifts, not reduces**: Instead of proving `hash(state_N) = hash(apply(state_0, ticks_0..N))`, you must prove `hash(executed_schedule) = ledger.checksum` plus prove the scheduler correctly interrupts and resumes schedules. The proof complexity is equivalent or higher.

From a state machine replication perspective, pre-computed schedules introduce **schedule versioning** as a distributed consensus problem. When a schedule is interrupted, all replicas must agree on:

- Which tick the interruption occurred at
- How to merge the new input with the partial schedule
- What the new schedule state is

Fixed timestep eliminates this: there is no "schedule state" to maintain. Each tick is an independent, stateless transition.

### 3. The Numerical Stability Requirement is Decisive

Expert 003's argument from game engine architecture proved decisive for ruling out pure event-driven approaches:

**Theorem (from numerical analysis):**
For exponential decay `v(t) = v₀ · e^(-λt)` discretized as `v[n+1] = v[n] · damping^Δt`, the discretization error is O(Δt²) when Δt is constant, but O(max(Δt)) when Δt varies.

This means variable timesteps accumulate numerical error faster than fixed timesteps. For deterministic replay across different platforms and execution speeds, we cannot accept variable Δt for continuous behaviors like camera inertia.

Event-driven advocates must therefore choose:

1. Variable Δt → non-determinism (unacceptable)
2. Fixed Δt → you've reinvented fixed timestep
3. Symbolic math → computationally prohibitive

### 4. Performance Concerns are Valid and Addressable

Expert 002's performance analysis was compelling:

| Scenario             | Fixed (Pure)  | Event-Driven | Suspend/Resume |
| -------------------- | ------------- | ------------ | -------------- |
| Continuous pan (10s) | 600 ticks     | 600 ticks    | 600 ticks      |
| Damping (3s)         | 180 ticks     | 180 ticks    | 180 ticks      |
| Idle (1 hour)        | 216,000 ticks | 0 ticks      | 0 ticks        |
| Background tab       | 216,000 ticks | 0 ticks      | 0 ticks        |

The idle overhead of pure fixed timestep is unacceptable for battery life, thermal management, and resource sharing in multi-tab browser environments.

**However**, this is solved by suspend/resume without requiring event-driven scheduling:

- During active periods: Fixed 60Hz ticks (same as event-driven during motion)
- During idle periods: Explicit kernel suspension (same efficiency as event-driven)
- No scheduler complexity: Simple state machine (active/suspended)

### 5. Provenance Tracking Requires Explicit Causality

Expert 004's formal methods perspective highlighted an important requirement: the ledger should record causal relationships, not clock artifacts.

**With pure fixed timestep:**

```
Tick 9842: []  // Empty
Tick 9843: [ExpandNode(id=5)]  // The event we care about
Tick 9844: []  // Empty
Tick 9845: []  // Empty
```

The empty ticks obscure causality. Debugging "why did X happen?" requires filtering noise.

**With suspend/resume:**

```
Tick 1000: [CameraPan(v=[10,5])]
Tick 1001: [PanContinue(v=[9.8,4.9])]
...
Tick 1180: [PanContinue(v=[0.001,0.0005])]
Tick 1181: [Suspend(reason="velocity_zero")]
// Gap - kernel suspended, no CPU usage, no storage
Tick 1182: [Resume(reason="UserClick"), ExpandNode(id=5)]
```

The suspension is an **explicit first-class event** in the ledger. When auditing or debugging, the absence of ticks is explained by a causal event (suspension), not by empty no-ops.

This satisfies the formal requirement: every ledger entry represents a meaningful state transition or lifecycle change, not a clock tick.

---

## The Distributed Systems Case for Suspend/Resume

From my domain expertise in distributed systems, suspend/resume offers critical advantages:

### Consensus on Kernel State

In a distributed setting (future-proofing for collaboration), replicas must agree on when the kernel is active vs. suspended. With fixed timestep + suspend/resume:

```typescript
// Replica A
if (!state.camera.hasVelocity && inputQueue.isEmpty()) {
  proposeSuspension(currentTick);
}

// On consensus commit
onSuspensionCommitted(tick) {
  ledger.append({ type: 'suspend', tick });
  kernelState = SUSPENDED;
  // All replicas enter suspended state at same logical tick
}
```

The suspension decision is **committed through the consensus protocol**, ensuring all replicas remain synchronized. This is straightforward because suspension is a deterministic function of state (velocity=0, no inputs).

With event-driven scheduling, replicas must reach consensus on **when to schedule the next tick**, which depends on:

- The scheduling algorithm (complex)
- Future predictions (when will inertia converge?)
- Platform-specific timing (epsilon thresholds)

The consensus overhead is significantly higher.

### Replay Guarantees

State machine replication requires:

```
∀ replicas R, if R processes inputs in same order → R converges to same state
```

With suspend/resume, replay is trivial:

```typescript
function replay(ledger: LedgerEntry[]): State {
  let state = initialState;
  let tick = 0;

  for (const entry of ledger) {
    switch (entry.type) {
      case 'tick':
        state = applyRules(state, entry.rules);
        tick++;
        break;

      case 'suspend':
        // Verify suspension was valid
        assert(!state.camera.hasVelocity);
        // Continue to next entry without advancing tick
        break;

      case 'resume':
        // Resume at next sequential tick
        tick++;
        state = applyRules(state, entry.rules);
        break;
    }
  }

  return state;
}
```

**Key properties:**

1. Tick count is monotonic (never decreases)
2. Tick count during suspension freezes (preserves determinism)
3. No wall-clock dependency (suspension duration is irrelevant)
4. Verification is local (each entry is independently verifiable)

With event-driven scheduling, replay must reconstruct scheduler state:

```typescript
function replayEventDriven(ledger: LedgerEntry[]): State {
  let state = initialState;
  let scheduler = new DeterministicScheduler();

  for (const entry of ledger) {
    // Must determine: what scheduled this tick?
    // Was it user input? A pre-computed schedule? A timeout?
    // Must verify: did scheduler produce correct timestamp?
    // Must handle: schedule interruptions, cancellations, merges
  }
}
```

The proof burden is significantly higher.

### Timestamp Authority

A fundamental theorem: **Any deterministic timestamp assignment is isomorphic to tick counting.**

In suspend/resume:

- Tick index is the authoritative timestamp
- When active: tick N occurs at time N × Δt
- When suspended: tick counter freezes, wall-clock time becomes irrelevant
- On resume: next tick is N+1, regardless of wall-clock gap

In event-driven:

- Timestamps must be computed and logged
- Sources: wall-clock (non-deterministic), computed from state (must be pure), or logged explicitly (equivalent to tick counting)
- The timestamp metadata must be part of consensus

Event-driven advocates are attempting to avoid "explicit ticks" while introducing "implicit ticks via timestamps." You cannot escape temporal quantization in a discrete system.

---

## Remaining Concerns and Caveats

### Concern 1: Epsilon Threshold for Suspension

All approaches require an epsilon threshold for "motion has stopped":

- Fixed timestep with suspend: `if (velocity < EPSILON) suspend();`
- Event-driven: `while (v > EPSILON) scheduleNext();`
- Pre-computed schedules: `while (v.magnitude() > EPSILON) { ... }`

The epsilon is unavoidable—it's a physical constant representing minimum perceptible motion.

**Caveat**: The epsilon value affects user experience (too high = abrupt stops, too low = long damping tails) and must be chosen carefully. However, this is a UX parameter, not an architectural flaw. It should be:

- Documented in the system specification
- Configurable for testing
- Part of the determinism contract

### Concern 2: Scheduled Wakeups

What about behaviors that need to wake up at a specific future time (e.g., "poll API in 5 seconds")?

With suspend/resume, this requires:

```typescript
// Explicit scheduled wakeup in ledger
Tick 1000: [Suspend]
Tick 1000: [ScheduleWakeup(delay=5000ms)] // Metadata
// Kernel sleeps for 5 seconds
Tick 1001: [Resume(reason="ScheduledWakeup"), PollAPI()]
```

The scheduled wakeup is an explicit ledger event. During replay, the tick counter advances by 1 (from 1000 to 1001), not by the wall-clock delay (5000ms / 16.67ms = 300 ticks).

**This preserves determinism**: the tick count represents state transitions, not wall-clock time. The 5-second delay is metadata for execution optimization, not canonical time.

**Caveat**: This means you cannot query "what was state at wall-clock time T?" only "what was state at tick N?" For provenance systems, this is acceptable—we care about causal sequence, not absolute time.

### Concern 3: Distributed Suspend/Resume Synchronization

In a multi-replica setting, suspension creates a coordination challenge:

```
Replica A: Proposes suspension at tick 1000
Replica B: Still processing tick 999 (slower)

If A suspends before B catches up, they diverge.
```

**Solution**: Suspension must be a committed consensus decision:

1. Replica proposes suspension when it detects idle state
2. Proposal goes through consensus protocol
3. All replicas commit suspension at same logical tick
4. No replica suspends before consensus

This adds latency (cannot suspend immediately when idle is detected), but preserves correctness. The latency is acceptable because suspension is an optimization, not a functional requirement.

**Caveat**: In high-latency networks, the suspension latency might exceed the idle period (user resumes before suspension commits). This is fine—the system remains correct, just misses the optimization. This is no different from any other eventual consistency scenario.

---

## Final Architectural Recommendation

**Adopt Fixed Timestep with Suspend/Resume**

### Specification

**Kernel Lifecycle:**

```typescript
enum KernelState {
  Active, // Ticking at 60 Hz
  Suspended // Zero ticks, zero CPU
}

// Suspension condition (checked every tick)
function shouldSuspend(state: State): boolean {
  return (
    state.camera.velocity.magnitude() < EPSILON &&
    state.scheduledRules.isEmpty() &&
    inputQueue.isEmpty()
  );
}

// Main kernel loop
while (true) {
  if (kernelState === Active) {
    tick();
    if (shouldSuspend(state)) {
      proposeSuspension(currentTick); // Goes through consensus
    }
  } else {
    await nextInput(); // Wake on input or scheduled wakeup
    proposeResume(currentTick); // Goes through consensus
  }
}
```

**Ledger Format:**

```typescript
type LedgerEntry =
  | { type: 'tick'; tick: number; rules: Rule[]; checksum: string }
  | { type: 'suspend'; tick: number; wall_clock_t: number }
  | { type: 'resume'; tick: number; wall_clock_t: number; trigger: Input | ScheduledRule };

// Example ledger
[
  { type: 'tick', tick: 1000, rules: [PanStart((v = [10, 5]))], checksum: '0xABC' },
  { type: 'tick', tick: 1001, rules: [PanContinue((v = [9.8, 4.9]))], checksum: '0xDEF' },
  // ... 179 more damping ticks ...
  { type: 'tick', tick: 1180, rules: [PanContinue((v = [0.001, 0.0005]))], checksum: '0x123' },
  { type: 'suspend', tick: 1181, wall_clock_t: 19.683 },
  // Gap: kernel suspended for 14.3 seconds of wall-clock time
  { type: 'resume', tick: 1181, wall_clock_t: 33.981, trigger: UserClick((nodeId = 5)) },
  { type: 'tick', tick: 1182, rules: [ExpandNode((id = 5))], checksum: '0x456' }
];
```

**Key Properties:**

1. Tick counter freezes during suspension (1181 → 1181)
2. Wall-clock time stored as metadata (for debugging)
3. Suspension and resume are explicit, verifiable events
4. Replay is deterministic: process ticks in sequence, skip suspended ranges

### Why This Satisfies All Concerns

**Determinism (Expert 001):**

- Fixed Δt = 16.67ms for all continuous behaviors
- Tick index is authoritative timestamp
- No wall-clock dependency during replay
- State machine replication is trivial: `state_N = fold(apply, state_0, entries_0..N)`

**Performance (Expert 002):**

- Zero CPU usage during suspension (same as event-driven)
- Zero ledger entries during suspension (same as event-driven)
- Modal use case (idle time) is optimized
- Background tabs automatically suspend (OS-friendly)

**Numerical Stability (Expert 003):**

- Fixed Δt for physics integration (no accumulation drift)
- Proven pattern from game engine architecture
- Simple execution model (tick or don't tick)
- No schedule management complexity

**Provenance (Expert 004):**

- Ledger records only meaningful events (ticks with rules, suspend, resume)
- Causality is explicit: "suspension caused no ticks" vs "no ticks happened mysteriously"
- Verification is compositional: prove active periods correct, prove lifecycle transitions correct
- Proof burden scales with events, not wall-clock time

**Architecture (Expert 005):**

- Complexity lives in well-understood layer (kernel lifecycle management)
- Separation of concerns: temporal semantics vs. execution optimization
- Precedent exists: every OS kernel has sleep/wake logic
- No novel abstractions that require extensive validation

---

## Conclusion

The question posed was: "Should ticks be driven by a fixed timestep rather than event-driven scheduling?"

Through three rounds of rigorous debate, we discovered that this was a false binary. The correct answer is:

**Yes, ticks should use fixed timestep—but the kernel should not always be ticking.**

Fixed timestep provides the deterministic temporal semantics required for state machine replication and numerical stability. Explicit kernel lifecycle management (suspend/resume) provides the efficiency required for real-world deployment.

The synthesis—Fixed Timestep with Suspend/Resume—combines the strengths of both approaches while avoiding their weaknesses. It is:

- Simple to reason about (fixed 60Hz when active, zero Hz when suspended)
- Efficient in practice (zero overhead during idle, which is the modal case)
- Deterministic by design (tick count is causal, wall-clock is metadata)
- Proven in production (OS kernels, game engines use this pattern)

**I recommend WARP adopt Fixed Timestep with Suspend/Resume at 60 Hz.**

---

**Expert 001**
**Distributed Systems, Determinism, Replay Guarantees**
**Confidence:** 95%
**Status:** Final recommendation based on complete debate synthesis

**Acknowledgments:** This conclusion was only possible through the rigorous challenges from Expert 002 (performance), Expert 003 (numerical stability), Expert 004 (formal methods), and especially Expert 005 (architectural synthesis). The debate process worked.
