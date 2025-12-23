# Opening Statement: Expert 002

**Domain**: Performance Engineering, Efficiency Analysis, Resource Utilization

## Position: AGAINST Fixed Timestep

### Executive Summary

From a performance engineering standpoint, **event-driven ticks are superior** for this use case. Fixed timestep creates unnecessary overhead, degrades user experience under variable load, and conflicts with the fundamental economics of a ledger-based system.

### Core Performance Arguments

#### 1. Wasteful Computation (Critical)

Fixed timestep forces the kernel to advance **even when nothing changes**:

- Camera at rest: zero rules to apply, yet tick fires every 16.67ms
- User idle: empty batches written to ledger
- Background tabs: burning CPU for no visual output
- **Result**: O(n) overhead where n = idle time, not O(n) where n = meaningful work

In event-driven systems, computational cost scales with **actual state changes**, not wall-clock time. This is foundational performance engineering.

#### 2. Ledger Bloat

The immutable ledger grows unbounded with fixed timestep:

```
Fixed @ 60Hz:
- 1 minute idle = 3,600 empty ticks
- 1 hour background = 216,000 receipts
- Replay cost: O(wall-clock time)

Event-driven:
- 1 minute idle = 0 ticks
- 1 hour background = 0 receipts
- Replay cost: O(meaningful events)
```

Storage is cheap, but **replay latency** is user-facing. Every empty tick compounds during playback.

#### 3. Frame Rate Independence is a False Constraint

Fixed timestep advocates claim "decoupling from frame rate" as a benefit. But:

- Rendering is already separated (stated in premise)
- Frame rate ≠ tick rate
- Event-driven can still use time-based interpolation for smooth motion
- Game engines use fixed timestep because physics solvers are numerically unstable; **our rules are discrete and deterministic**

We're not integrating differential equations. We're applying graph rewrites. Different problem class.

#### 4. Variable Latency Under Load

Fixed timestep creates **input lag** when kernel can't keep up:

```
Frame budget exceeded:
T=0ms   : User presses key
T=16ms  : Tick 1 starts (already delayed)
T=40ms  : Tick 1 completes (missed deadline)
T=48ms  : Tick 2 starts (user's input is stale)
```

Event-driven processes inputs immediately or drops frames explicitly. Fixed timestep **hides overruns** until they cascade into visible stuttering.

#### 5. Inertia is Not an Excuse

The "camera has inertia" argument doesn't require fixed timestep:

**Event-driven with scheduled continuations:**

```typescript
onKeyRelease(velocity: Vec2) {
  // Schedule decay ticks only while velocity > threshold
  const decay = () => {
    velocity *= dampingFactor;
    if (velocity.magnitude() > epsilon) {
      applyRule({ type: 'camera.move', velocity });
      scheduleAfter(16ms, decay); // Self-scheduling
    }
  };
  decay();
}
```

This:

- Generates ticks **only during damping**
- Stops when motion becomes imperceptible
- Produces identical replay (deterministic scheduler)
- Zero overhead when idle

Compare to fixed timestep: ticks fire forever, even when camera stopped moving 3 decimal places ago.

### Determinism Counter-Argument

Fixed timestep advocates will claim "easier determinism." False:

**Both systems require**:

- Deterministic rule application (✓ stated in premise)
- Deterministic input ordering (✓ trivial: timestamp + sequence number)
- Deterministic scheduling (✓ event-driven with priority queue)

**Event-driven adds**:

- Explicit causality chains (tick N fires because rule X scheduled it)
- Smaller replay surface (fewer ticks = fewer edge cases)

Determinism is about **reproducible execution order**, not tick cadence.

### Real-World Performance Profile

| Scenario               | Fixed Timestep         | Event-Driven        | Winner                          |
| ---------------------- | ---------------------- | ------------------- | ------------------------------- |
| Idle user (1min)       | 3,600 ticks            | 0 ticks             | Event-driven (100% saving)      |
| Smooth pan (5sec)      | 300 ticks              | ~300 ticks          | Tie                             |
| Single click           | 1 tick + 3,599 idle    | 1 tick              | Event-driven (99.97% saving)    |
| Background tab (1hr)   | 216,000 ticks          | 0 ticks             | Event-driven (battery, thermal) |
| Replay (10min session) | Process all wall-clock | Process events only | Event-driven (lower latency)    |

The **modal use case** for most software is idle time. Optimizing for continuous motion is premature.

### Complexity Trade-Off

Yes, event-driven adds scheduler logic. But:

- **One-time cost**: Write scheduler once, reuse forever
- **Ongoing cost of fixed**: Every feature must handle empty ticks, stale inputs, and frame drops
- Modern runtimes (Node.js event loop, Rust async) already provide deterministic event scheduling

We're not building a scheduler from scratch. We're choosing the right primitive.

### Proposed Voting Options

Given the performance data, I propose these options:

**Option A**: Pure event-driven

- Ticks fire only when rules are enqueued (user input, scheduled continuations)
- Inertia uses self-scheduling pattern
- Ledger records only meaningful state changes

**Option B**: Hybrid with adaptive tick rate

- Base tick rate (e.g., 60Hz) when motion detected
- Drop to 0Hz after N idle ticks
- Resume on input
- (Worst of both worlds: complexity without savings)

**Option C**: Fixed timestep

- Constant 60Hz tick regardless of activity
- Accept ledger bloat as "cost of determinism"
- (Rejected by Expert 002)

### Conclusion

Performance engineering demands we **charge for work done, not time passed**. Event-driven ticks align system cost with user value. Fixed timestep is a tax on idle time.

The question is not "can we afford fixed timestep?" (we can). The question is "why would we choose it when event-driven is strictly superior for this workload?"

I vote **Option A**: Pure event-driven.

---

**Expert 002**
Performance Engineering
