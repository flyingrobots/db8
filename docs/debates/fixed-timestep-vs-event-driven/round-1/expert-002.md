# Round 1: Expert 002

**Domain**: Performance Engineering, Efficiency Analysis, Resource Utilization
**Date**: 2025-12-20

## My Perspective

After reviewing all opening statements, I must respond to several technical claims that overstate fixed timestep benefits while underestimating event-driven efficiency.

### Response to Expert 001: "Determinism Requires Temporal Quantization"

Expert 001 claims event-driven scheduling is non-deterministic, but this is a straw man argument. The comparison is between:

- **Fixed timestep**: Time = implicit (tick index)
- **Event-driven with deterministic scheduler**: Time = explicit (in ledger)

Both can be deterministic. The real question is overhead cost, not feasibility.

Expert 001's ledger example reveals the performance issue:

```
Tick 2: []  // "No input, but still a tick"
```

This is precisely what performance engineering opposes. Why write empty receipts? The counter-argument "storage is cheap" misses that:

1. **Replay latency is not cheap**: Processing 216,000 empty ticks per idle hour degrades user experience
2. **CPU cycles are not free**: Waking the kernel 60 times/sec when idle drains mobile batteries
3. **Compression doesn't eliminate work**: Run-length encoding reduces storage but replay must still iterate

### Response to Expert 003: "Inertia Requires Fixed Timestep"

Expert 003's damping example actually supports event-driven:

```typescript
velocity *= Math.pow(dampingFactor, Δt);
```

This works with **consistent** Δt, not **uniform wall-clock** Δt. Event-driven can absolutely maintain consistent timesteps:

```typescript
// Event-driven with deterministic Δt
const PHYSICS_DT = 16.67; // Same Δt every physics tick

function scheduleInertiaDecay(velocity: Vec2) {
  const nextTick = lastPhysicsTime + PHYSICS_DT;
  scheduler.enqueue(nextTick, () => {
    velocity *= Math.pow(DAMPING, PHYSICS_DT);
    if (velocity.magnitude() > EPSILON) {
      scheduleInertiaDecay(velocity); // Self-schedule
    }
  });
}
```

This produces identical numerical results to fixed timestep, but stops ticking when motion ceases. Fixed timestep cannot stop—it burns CPU forever.

**Performance data Expert 003 ignores:**

- Camera at rest: Fixed = 60 ticks/sec, Event-driven = 0 ticks/sec (infinite efficiency gain)
- Inertia dampening over 5 seconds: Both systems produce ~300 ticks (no difference)
- User makes one click then walks away: Fixed = continuous overhead, Event-driven = single tick

### Response to Expert 004: Strengthening the Formal Argument

Expert 004 correctly identifies that event-driven provides **cleaner provenance**. I'll add performance implications:

**Verification Cost Asymmetry:**

```
Fixed @ 60Hz, 1-hour session:
- Ledger entries: 216,000
- Meaningful entries: ~500 (0.2%)
- Noise ratio: 99.8%

Event-driven, same session:
- Ledger entries: ~500
- Meaningful entries: ~500 (100%)
- Noise ratio: 0%
```

From a performance perspective, this noise isn't just storage—it's **computational overhead during every replay and audit**. Security audits, compliance checks, and debugging all pay the O(wall-clock-time) cost.

### Response to Expert 005: Architectural Realism

Expert 005 asks the right question: "Where should complexity live?" But underestimates the complexity fixed timestep creates:

**Hidden Costs of Fixed Timestep:**

1. Input buffering: Must queue inputs between ticks (what if buffer overflows?)
2. Stale input handling: User input at t=16.5ms doesn't apply until t=33.3ms (17ms lag)
3. Frame drops: When tick duration exceeds Δt, system silently falls behind
4. Ledger pruning: Need separate compression system for "empty" ticks

**Event-Driven Complexity:**

1. Scheduler: Standard priority queue (well-understood, O(log n) operations)
2. Continuation rules: Explicit (clearer than implicit "every tick" behavior)

The fixed timestep pattern from game engines is being misapplied. Games need fixed timestep because **physics solvers are numerically unstable** with variable Δt. But WARP doesn't integrate differential equations—it applies graph rewrites. Different problem class.

### New Performance Analysis: Worst-Case Scenarios

Consider performance under stress:

**Scenario 1: Complex graph with many rules**

- Fixed: Process ALL rules every 16.67ms (even if unchanged)
- Event-driven: Process only rules triggered by actual changes

**Scenario 2: User switches to background tab**

- Fixed: Continues 60 ticks/sec (battery drain, thermal throttling)
- Event-driven: Zero ticks until user returns (OS-friendly behavior)

**Scenario 3: Network latency causes input burst**

- Fixed: Must process burst in single tick (frame drop risk)
- Event-driven: Can distribute processing across time (better load balancing)

### Measurement Proposal

Rather than argue in theory, I propose benchmarking:

```typescript
// Test scenario
const scenario = {
  duration: '10 minutes',
  interactions: [
    { time: 0, action: 'pan camera', duration: '2s' },
    { time: 120, action: 'click node', duration: 'instant' },
    { time: 300, action: 'pan camera', duration: '3s' }
    // 8+ minutes of idle time
  ]
};

// Metrics to compare
const metrics = {
  totalTicks: number,
  ledgerSize: bytes,
  replayTime: milliseconds,
  cpuWakeups: number,
  batteryDrain: milliwatts
};
```

I predict:

- Fixed: ~36,000 ticks, dominated by idle overhead
- Event-driven: ~300 ticks, proportional to actual work

## Extension Vote

**Continue Debate**: YES
**Reason**: The fixed timestep advocates have not addressed the fundamental inefficiency of processing empty ticks. We need either:

1. Concrete performance measurements showing fixed timestep overhead is acceptable
2. Or acknowledgment that event-driven with deterministic scheduling solves the determinism concern

The debate has clarified positions but hasn't resolved the core trade-off: is continuous CPU overhead worth simpler code?

## Proposed Voting Options

Based on Round 1 discussion, I refine my voting options:

**Option A: Pure Event-Driven with Deterministic Scheduler**

- Ticks occur only when rules are enqueued
- Scheduler uses deterministic priority queue (timestamp + sequence number)
- Inertia/physics use self-scheduling pattern with fixed Δt = 16.67ms
- Ledger records only actual state transitions
- **Performance**: O(events), optimal for sparse interaction
- **Determinism**: Equivalent to fixed (timestamp is explicit, not derived)

**Option B: Fixed Timestep at 60Hz**

- Tick every 16.67ms regardless of activity
- Empty ticks recorded in ledger (with optional compression)
- Simpler implementation, proven pattern from game engines
- **Performance**: O(wall-clock-time), pays continuous overhead
- **Determinism**: Equivalent to event-driven (tick index is implicit time)

**Option C: Adaptive Hybrid**

- Fixed 60Hz when motion detected (velocity > threshold)
- Event-driven when fully idle
- State machine to switch modes
- **Performance**: Attempts "best of both worlds"
- **Determinism**: Requires mode-switching logic in ledger
- **Complexity**: Highest of all options (not recommended)

**Option D: Benchmark First, Then Decide**

- Implement minimal prototypes of A and B
- Run realistic workload scenarios
- Measure: tick count, ledger size, replay time, CPU usage
- Vote based on empirical data rather than theory
- **This is my actual recommendation**

## Key Question for Finals

If we proceed to finals without benchmarking, the deciding factor should be:

**Is the primary workload sparse (mostly idle) or dense (continuous interaction)?**

- If sparse (likely for most users): Event-driven wins on efficiency
- If dense (constant panning/interaction): Fixed timestep becomes competitive

But we don't actually know the workload distribution. We're optimizing blind.

---

**Expert 002**
Performance Engineering
