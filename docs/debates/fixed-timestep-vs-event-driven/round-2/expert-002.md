# Round 2: Expert 002

**Domain**: Performance Engineering, Efficiency Analysis, Resource Utilization
**Date**: 2025-12-20

## My Perspective

After reviewing all Round 1 statements, I see significant convergence toward acknowledging the performance concerns I raised, but I must address two new proposals that claim to solve efficiency without abandoning fixed timestep.

### Response to Expert 004's Pre-Computed Deterministic Schedules

Expert 004's proposal is technically sound but reveals something important: **it's event-driven in disguise**.

The proposed pattern:

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

  return { type: 'DampingSchedule', ticks, checksum: hash(ticks) };
}
```

**Analysis from a performance engineering perspective:**

1. **This IS event-driven scheduling**: You're computing a list of future ticks and enqueuing them. The fact that they use fixed Δt internally doesn't make the system fixed-timestep—it makes the system event-driven with quantized scheduling.

2. **Performance characteristics are identical to pure event-driven**:
   - Idle camera: 0 ticks enqueued = 0 CPU wakeups
   - Active damping: ~300 ticks over 5 seconds = same as fixed timestep during active period
   - The optimization Expert 004 achieved is precisely what I advocated for

3. **The checksum adds overhead without value**: Computing `hash(ticks)` for a 300-element array is wasted work. Determinism comes from the computation itself being pure, not from post-hoc verification. If you don't trust `Math.pow(dampingFactor, TICK_DELTA)` to be deterministic, a hash won't save you.

**What Expert 004 has proven**: You can achieve numerical stability with event-driven ticks, as long as physics calculations use consistent Δt. This actually strengthens the event-driven case rather than arguing against it.

### Response to Expert 005's Suspend/Resume Pattern

Expert 005's proposal is the most pragmatic compromise, but the performance analysis reveals it's incomplete:

```typescript
enum KernelState {
  Active, // Fixed 60Hz ticks
  Suspended // Zero ticks, wake on input
}
```

**Critical questions from a performance perspective:**

1. **What triggers resume?**: If user input, how do you avoid input lag? Fixed timestep has 16.67ms quantization—does resume force immediate tick or wait for next boundary?

2. **What about the "mostly idle" scenario?**: User clicks once per minute while browsing. Do we:
   - Suspend between clicks? (Then we're admitting event-driven is correct)
   - Stay active for some timeout? (Arbitrary threshold, still burns CPU)
   - Suspend only when velocity=0? (Ignores discrete interactions)

3. **Ledger complexity**: Now you have three event types:
   - Normal ticks with rules
   - Suspend events
   - Resume events

   This is strictly more complex than pure event-driven, which only has "rule application events."

**The performance profile:**

| Scenario             | Pure Fixed      | Fixed+Suspend             | Pure Event-Driven |
| -------------------- | --------------- | ------------------------- | ----------------- |
| Continuous pan (10s) | 600 ticks       | 600 ticks                 | 600 ticks         |
| Single click, idle   | 216k ticks/hour | 1 tick + suspend overhead | 1 tick            |
| Background tab       | 216k ticks/hour | 0 ticks (if suspended)    | 0 ticks           |

Expert 005's suspend/resume achieves event-driven performance but with added state machine complexity.

### Addressing Expert 001's "Run-Length Encoding Solves Everything"

Expert 001 correctly identifies that storage compression addresses the ledger bloat concern. However, the performance analysis reveals this doesn't solve the fundamental problems:

**What RLE solves:**

- Storage cost: YES (idle periods compress to single entry)
- Network cost: YES (transmitting ledgers is cheaper)

**What RLE doesn't solve:**

- CPU wakeup overhead: NO (kernel still ticks 60/sec while "active")
- Replay latency: PARTIALLY (decompressing is faster than re-executing, but not free)
- Battery drain: NO (mobile devices still wake 60/sec)
- Provenance clarity: NO (auditors still wade through compressed noise)

**Measurement proposal:**

I maintain that we need empirical data. Expert 003 is right that we lack usage telemetry. Here's what we should measure:

```typescript
interface PerformanceMetrics {
  // Execution metrics
  totalTicks: number;
  emptyTicks: number;
  meanTickDuration: number; // microseconds
  p99TickDuration: number;

  // Resource metrics
  cpuWakeupsPerSecond: number;
  totalCPUTime: number; // milliseconds
  peakMemoryUsage: number; // bytes

  // Ledger metrics
  uncompressedLedgerSize: number;
  compressedLedgerSize: number;
  compressionRatio: number;
  replayTime: number; // milliseconds to full replay

  // Usage pattern
  sessionDuration: number; // seconds
  activeDuration: number; // seconds with velocity > 0
  idleDuration: number; // seconds with velocity = 0
  discreteEventCount: number; // clicks, keypresses
}
```

**Predicted results for 10-minute session with 30 seconds of actual interaction:**

| Metric          | Fixed 60Hz | Fixed+RLE | Fixed+Suspend | Event-Driven |
| --------------- | ---------- | --------- | ------------- | ------------ |
| Total ticks     | 36,000     | 36,000    | ~2,000        | ~2,000       |
| Empty ticks     | ~34,000    | ~34,000   | 0             | 0            |
| CPU wakeups/sec | 60         | 60        | ~3            | ~3           |
| Compressed size | ~500 KB    | ~50 KB    | ~30 KB        | ~30 KB       |
| Replay time     | 450ms      | 180ms     | 25ms          | 25ms         |

### Addressing Expert 003's "Game Engine Precedent"

Expert 003 argues that fixed timestep is proven in game engines, but the disanalogy is critical:

**Game engines need fixed timestep because:**

1. Numerical integration of ODEs (Newton's laws)
2. Collision detection with continuous collision detection (CCD)
3. Networked multiplayer with lockstep synchronization
4. Deterministic physics for competitive play

**WARP is different:**

1. Graph rewrites (discrete, not continuous)
2. No collision detection
3. Single-user (no multiplayer synchronization)
4. One continuous behavior (camera inertia) that can be pre-computed (as Expert 004 showed)

**The irony**: Modern game engines (Unity, Godot) actually use a hybrid approach:

- Physics runs at fixed timestep (50-120 Hz)
- Rendering runs at variable framerate (vsync)
- Input processing is event-driven
- Audio is event-driven
- UI is event-driven

They don't run EVERYTHING at fixed timestep—only the subsystem that requires it (physics solver). WARP's equivalent would be running camera damping at fixed intervals, not the entire kernel.

### New Performance Concern: The Compounding Effect

Something I didn't emphasize in Round 1: **Performance costs compound in real-world deployment**.

Consider a user with 10 WARP tabs open (not unrealistic for knowledge workers):

**Fixed timestep:**

- 10 tabs × 60 ticks/sec = 600 kernel ticks/sec
- Even suspended tabs might tick if we don't implement perfect detection
- Page visibility API helps, but adds complexity

**Event-driven:**

- Only active tab ticks
- Background tabs: 0 overhead
- Better OS-level resource citizenship

This matters for browser performance, battery life on laptops, and thermal management.

### Refined Position

After Round 1, I maintain **strong support for event-driven** but with important acknowledgments:

1. **Expert 004 is correct**: Pre-computed schedules with fixed Δt solve numerical stability. This is compatible with event-driven ticks.

2. **Expert 005 is correct**: Suspend/resume addresses idle overhead. But this IS event-driven with extra steps—just make it explicit.

3. **Expert 003 is correct**: We need empirical data. I propose Option D (prototype both) before final decision.

4. **Expert 001 is correct**: Determinism is paramount. But event-driven with deterministic scheduling achieves this.

**My recommendation**: Event-driven ticks with pre-computed physics schedules (combining Expert 002 + Expert 004's insights).

**Concrete design:**

```typescript
// Physics uses fixed Δt for stability
const PHYSICS_TICK = 16.67; // ms

// Scheduler is deterministic priority queue
class DeterministicScheduler {
  private queue: PriorityQueue<ScheduledRule>;

  enqueuePhysics(initialVelocity: Vec2) {
    // Pre-compute entire schedule (Expert 004's approach)
    const schedule = computeDampingSchedule(initialVelocity);

    // Enqueue all ticks at once
    schedule.ticks.forEach((tick, i) => {
      this.queue.insert({
        timestamp: currentTime + i * PHYSICS_TICK,
        rule: { type: 'camera.move', velocity: tick.velocity }
      });
    });
  }

  nextTick(): Tick | null {
    return this.queue.isEmpty() ? null : this.queue.extractMin();
  }
}
```

This achieves:

- Event-driven efficiency: O(actual events), not O(wall clock time)
- Numerical stability: Physics uses consistent Δt
- Determinism: Priority queue with explicit timestamps
- Zero idle overhead: No ticks when queue empty

## Extension Vote

**Continue Debate**: NO

**Reason**: The core positions are now clear and well-argued. Expert 004's pre-computed schedules and Expert 005's suspend/resume both demonstrate that the performance concerns can be addressed. We have enough technical depth to vote. The remaining question is values: optimize for implementation simplicity (fixed timestep) or runtime efficiency (event-driven). Further debate won't change the technical trade-offs—we need a decision.

However, I strongly advocate for **Option D: Prototype both and measure** before final vote. The performance predictions I've made (216k ticks/hour idle overhead) should be validated, not assumed.

## Proposed Voting Options

Refined based on Round 1 convergence:

**Option A: Pure Fixed Timestep @ 60Hz with Run-Length Encoding**

- Pros: Simplest implementation, proven pattern
- Cons: CPU overhead when idle, ledger noise
- Vote if: Simplicity > efficiency

**Option B: Event-Driven with Pre-Computed Physics Schedules**

- Pros: Optimal efficiency, clean provenance
- Cons: Scheduler complexity, less common pattern
- Vote if: Efficiency > simplicity

**Option C: Fixed Timestep with Suspend/Resume State Machine**

- Pros: Balances both concerns
- Cons: Added state machine complexity, three event types
- Vote if: Seeking compromise

**Option D: Prototype Both, Measure, Then Decide**

- Build minimal implementations of A and B
- Run realistic workload scenarios
- Measure: tick count, CPU time, replay latency, ledger size
- Vote based on data, not theory
- **My recommendation**

**Option E: Deferred—Ship Event-Driven First**

- Easier to implement initially
- Migrate to fixed if performance is adequate
- Risk: Migration cost if wrong choice

---

**Expert 002**
Performance Engineering
**Confidence**: 90% (high confidence that event-driven + pre-computed schedules achieves best performance; moderate confidence that simplicity cost is acceptable)
**Key Insight**: Expert 004's proposal proves event-driven can achieve numerical stability, eliminating the main technical objection.
