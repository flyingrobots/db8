# Round 2 Response: Expert 003

**Domain Expertise**: Game engine architecture, fixed timestep patterns, simulation loops, physics integration, inertia handling

**Date**: 2025-12-20

---

## My Perspective

After reviewing Round 1, I see two significant developments that require my response:

1. **Expert 004's "pre-computed deterministic schedules"** - an attempt to achieve fixed-Δt numerical stability within event-driven ticks
2. **Expert 005's "suspend/resume pattern"** - fixed timestep with explicit lifecycle management

Let me address each, then clarify why my position remains unchanged.

### Response to Expert 004: Pre-computed Schedules Don't Solve the Core Problem

Expert 004's proposal deserves serious consideration:

```typescript
function computeDampingSchedule(v0: Vec2, dampingFactor: number): Schedule {
  const ticks: Array<{ delay: number; velocity: Vec2 }> = [];
  let v = v0;
  let t = 0;

  while (v.magnitude() > EPSILON) {
    t += TICK_DELTA;
    v = v.multiply(Math.pow(dampingFactor, TICK_DELTA));
    ticks.push({ delay: t, velocity: v });
  }

  return { type: 'DampingSchedule', ticks, checksum: hash(ticks) };
}
```

This is clever, but it has **three critical flaws**:

#### Flaw 1: You've Reinvented Fixed Timestep

Look at the inner loop: `t += TICK_DELTA`. This is literally a fixed timestep simulation running inside the scheduling function. You haven't eliminated fixed timestep—you've moved it from the kernel loop to the schedule generator.

The schedule is still a sequence of ticks at fixed 16.67ms intervals. The only difference is that they're "pre-declared" rather than "discovered at runtime." From a computational perspective, these are equivalent.

#### Flaw 2: Interruption Complexity

What happens when the user interrupts a damping schedule? Expert 004 asks this question in their finals but doesn't answer it:

```
Scenario: User pans camera (schedule A starts)
After 500ms: User pans again (schedule B starts)
Problem: Schedule A is incomplete, Schedule B assumes fresh state
```

You now need:

- Schedule interruption logic
- Partial schedule application
- State merging when schedules conflict
- Ledger representation of "schedule A interrupted at tick 30/60"

Compare to fixed timestep:

```
Every tick: Apply damping to current velocity
User input: Set new velocity
Done.
```

The fixed timestep approach **naturally handles interruption** because each tick is independent. Pre-computed schedules create dependency chains that must be unwound.

#### Flaw 3: The Epsilon Problem Returns

Expert 004's while-loop condition: `while (v.magnitude() > EPSILON)`. This threshold is doing critical work:

- Too high: Camera stops abruptly (bad UX)
- Too low: Schedule has hundreds of ticks (storage bloat)
- Platform-dependent: Different FPU implementations might converge at different iterations

In Round 1, I noted that epsilon is arbitrary. Expert 004's proposal doesn't solve this—it moves the epsilon decision from "when to stop ticking" to "how long to make the schedule."

**The architectural insight**: You cannot avoid the convergence problem. Either you:

- Run forever (pure fixed timestep)
- Pick an epsilon (arbitrary threshold, now part of determinism contract)
- Use exact symbolic math (impractical for real-time simulation)

Pre-computed schedules pick option 2, but so does naive event-driven. The problem hasn't been solved—just renamed.

### Response to Expert 005: Suspend/Resume is the Right Pattern

Expert 005's synthesis is the most important development in Round 1:

> **Decision 1**: When kernel is active, how do ticks work?
> Answer: Fixed timestep
>
> **Decision 2**: When should kernel suspend?
> Answer: When no continuous behaviors running

**I fully endorse this approach.** Here's why it's superior to both pure fixed and pure event-driven:

#### It's a Proven Pattern

Expert 005 notes: "this is literally how sleep() works." Let me add: **this is how every modern game engine handles backgrounding.**

When an iOS/Android game is backgrounded:

```cpp
// Unity/Unreal pattern
void OnApplicationPause(bool paused) {
  if (paused) {
    Time.timeScale = 0;  // Freeze all time-based updates
    StopMainLoop();      // Don't tick while invisible
  } else {
    ResumeMainLoop();    // Pick up where we left off
  }
}
```

The game loop doesn't "switch to event-driven mode"—it **stops completely**. Time doesn't advance. Replay treats the pause as an atomic event: "at tick N, system suspended."

#### It Solves Expert 002's Valid Concern

Expert 002's strongest argument was background tab battery drain. Suspend/resume addresses this directly:

| State          | Fixed (Pure)  | Event-Driven | Suspend/Resume |
| -------------- | ------------- | ------------ | -------------- |
| Active panning | 60 ticks/sec  | 60 ticks/sec | 60 ticks/sec   |
| Damping (3s)   | 180 ticks     | 180 ticks    | 180 ticks      |
| Idle (1 hour)  | 216,000 ticks | 0 ticks      | 0 ticks        |
| Background tab | 216,000 ticks | 0 ticks      | 0 ticks        |

Suspend/resume gives us event-driven's idle efficiency **without** event-driven's scheduling complexity.

#### It Preserves Fixed Timestep's Determinism

The ledger for suspend/resume:

```typescript
Tick 1000: [ApplyRule(pan_start)]
Tick 1001: [ApplyDamping(v=0.98)]
Tick 1002: [ApplyDamping(v=0.96)]
// ... damping continues ...
Tick 1180: [ApplyDamping(v=0.001)]
Tick 1181: [SuspendKernel(reason=velocity_below_threshold)]
// Gap (no ticks, no CPU, no storage)
Tick 1182: [ResumeKernel(reason=user_input), ApplyRule(pan_start)]
```

Replay behavior:

```typescript
function replay(ledger: Ledger): State {
  let state = initialState;
  for (const entry of ledger) {
    if (entry.type === 'suspend') {
      // Verify: state is actually idle
      assert(state.velocity.magnitude() < EPSILON);
      // Continue to next entry (no tick advancement)
    } else if (entry.type === 'resume') {
      // Verify: next entry is the tick we expect
      assert(entry.tick === currentTick + 1);
    } else {
      state = applyTick(state, entry);
      currentTick++;
    }
  }
  return state;
}
```

The suspend/resume events are **explicit in the ledger**, making them part of the deterministic replay. There's no ambiguity about "when did the system stop ticking?"

### Addressing the Numerical Stability Question

Both Expert 001 and Expert 004 are circling around the same formal property: **temporal discretization must be uniform for numerical stability**.

Let me state this precisely:

**Theorem (from numerical analysis):**
For exponential decay `v(t) = v₀ · e^(-λt)` discretized as `v[n+1] = v[n] · damping^Δt`, the discretization error is `O(Δt²)` when Δt is constant, but `O(max(Δt))` when Δt varies.

**Translation**: Variable timesteps accumulate error faster than fixed timesteps.

**Event-driven proponents must choose:**

1. **Variable Δt**: Accept accumulating numerical error (non-deterministic across platforms)
2. **Fixed Δt**: Use regular intervals (but now you've reinvented fixed timestep)
3. **Symbolic math**: Compute `v(t) = v₀ · e^(-λ·t)` exactly (prohibitively expensive for real-time)

Expert 004's pre-computed schedules pick option 2. But if you're using fixed Δt anyway, why not just... use fixed timestep in the kernel?

The "optimization" is that you pre-declare how many ticks you'll need. But this requires:

- Epsilon threshold (arbitrary)
- Schedule interruption handling (complex)
- Schedule storage in ledger (same bytes as ticks)

You've traded **simple iteration** for **complex schedule management** with no determinism benefit.

### Why Event-Driven Keeps Failing for Continuous Physics

I want to address why game engines universally use fixed timestep, because this pattern has been battle-tested for 30+ years.

**The historical lesson:**

Early game engines (1990s) tried variable timestep:

```cpp
// Quake-era approach (BAD)
void Update() {
  float dt = GetWallClockDelta();  // Variable!
  ApplyPhysics(dt);
}
```

Problems discovered:

1. **Frame rate affects physics**: 30fps vs 60fps games behaved differently
2. **Spiral of death**: Slow frame → large dt → more work → slower frame → larger dt...
3. **Non-determinism**: Same inputs on different machines = different outcomes

**The solution (Glenn Fiedler's canonical article):**

```cpp
// Fixed timestep with accumulator
const float PHYSICS_DT = 1.0f/60.0f;
float accumulator = 0.0f;

void Update() {
  float frameDt = GetWallClockDelta();
  accumulator += frameDt;

  while (accumulator >= PHYSICS_DT) {
    FixedUpdatePhysics(PHYSICS_DT);  // Always same Δt
    accumulator -= PHYSICS_DT;
  }
}
```

This is the **industry standard** for deterministic physics. Unity, Unreal, Godot—all use variants of this.

**Why am I explaining game engine history?**

Because WARP has the same properties as game physics:

- Continuous behaviors (camera inertia) mixed with discrete events (user input)
- Determinism requirements (provenance replay)
- Numerical stability needs (damping must converge consistently)

The fact that game engines converged on fixed timestep after decades of trying alternatives should inform our decision.

### The Real Trade-off

After Round 1, I see the actual choice more clearly:

**Fixed Timestep with Suspend/Resume** (Expert 005's synthesis):

- Simple: Kernel runs at 60 Hz or doesn't run at all
- Deterministic: Replay ticks 0..N or skips suspended ranges
- Efficient: Zero CPU when idle (suspend) matches event-driven
- Proven: This is the game engine pattern
- Complexity: Kernel lifecycle (suspend/resume conditions)

**Event-Driven with Pre-computed Schedules** (Expert 004's proposal):

- Complex: Schedule generation, interruption, merging
- Deterministic: If schedule generator is pure (non-trivial proof)
- Efficient: Same as suspend/resume (only ticks during activity)
- Novel: No production precedent for this pattern
- Complexity: Schedule logic, epsilon tuning, ledger format

I see no advantage to Expert 004's approach. It has event-driven's complexity plus fixed timestep's regular intervals, but with additional schedule management overhead.

### Revised Position

I **strengthen my support for fixed timestep** with the following refinement:

**Recommended Architecture:**

1. **Kernel lifecycle**: Active (60 Hz ticks) or Suspended (zero ticks)
2. **Suspend condition**: `velocity < epsilon AND inputQueue.empty() AND !scheduledRules`
3. **Resume condition**: `inputQueue.hasItems() OR scheduledRules`
4. **Ledger format**:
   - Active ticks: `Tick N: [rules...]`
   - Suspension: `Tick N: [Suspend]`
   - Gap: No entries (no ticks fired)
   - Resume: `Tick N+1: [Resume, rules...]`
5. **Storage optimization**: Run-length encode tick ranges with identical state

This gives us:

- Fixed timestep's determinism (Expert 001)
- Event-driven's efficiency (Expert 002)
- Game engine precedent (Expert 003, me)
- Clean provenance (Expert 004)
- Architectural clarity (Expert 005)

### Final Technical Point: The Epsilon is Unavoidable

Every approach requires an epsilon threshold:

- **Fixed timestep**: When to suspend? `velocity < epsilon`
- **Event-driven**: When to stop scheduling? `velocity < epsilon`
- **Pre-computed schedule**: How many ticks to schedule? `while (v > epsilon)`

The epsilon is a physical constant of the system (minimum perceptible motion). It's not eliminated by architectural choice—it's moved around.

Given that epsilon exists regardless, the question becomes: **where does it create the least complexity?**

**Fixed with suspend/resume**: `if (velocity < EPSILON) suspend();`

- One threshold check per tick
- Clear semantics: "motion has stopped"
- Explicit in ledger

**Event-driven with schedules**: `while (v > EPSILON) scheduleNext();`

- Threshold affects schedule length
- Affects ledger size (schedule metadata)
- Interruption requires epsilon re-check

The suspend/resume pattern makes epsilon a **lifecycle decision** (when to sleep). Event-driven makes epsilon a **scheduling parameter** (how far ahead to plan). The former is simpler.

## Extension Vote

**Continue Debate**: NO

**Reason**: Round 1 has achieved synthesis. Expert 005's suspend/resume pattern addresses all major concerns:

- Expert 001's determinism requirements (fixed timestep while active)
- Expert 002's efficiency requirements (zero overhead while idle)
- Expert 004's provenance requirements (explicit suspend/resume events)
- My numerical stability requirements (fixed Δt during physics)

The remaining questions are implementation details (epsilon value, suspend conditions) rather than architectural fundamentals. We should proceed to finals with clear options.

## Proposed Final Voting Options

Based on Round 1 and 2 discussion:

### Primary Vote: Tick Architecture

**Option A: Fixed Timestep with Suspend/Resume (RECOMMENDED)**

```typescript
// Active mode: 60 Hz fixed ticks
while (kernelActive) {
  tick();
  if (shouldSuspend()) {
    ledger.append({ type: 'suspend', tick });
    kernelActive = false;
  }
}

// Suspended mode: Wait for input
await inputQueue.next();
ledger.append({ type: 'resume', tick });
kernelActive = true;
```

- **Determinism**: Trivial (tick sequence is explicit)
- **Efficiency**: Zero cost when idle
- **Complexity**: Low (proven pattern)
- **Precedent**: Every major game engine

**Option B: Event-Driven with Pre-computed Schedules**

```typescript
// Schedule damping at PanStart
const schedule = computeDampingSchedule(v0);
ledger.append({ type: 'schedule', ticks: schedule.ticks, checksum });

// Process scheduled ticks
for (const tick of schedule.ticks) {
  await sleep(tick.delay);
  applyDamping(tick.velocity);
}
```

- **Determinism**: Requires schedule generator proof
- **Efficiency**: Same as Option A
- **Complexity**: High (schedule interruption, merging)
- **Precedent**: None in production systems

**Option C: Pure Fixed Timestep (No Suspend)**

- Rejected based on Expert 002's efficiency argument
- Background tab battery drain is unacceptable

**Option D: Pure Event-Driven (Variable Δt)**

- Rejected based on numerical instability
- Expert 004 withdrew this in Round 1

### Secondary Parameters (if Option A wins)

1. **Tick rate**: 60 Hz (recommended), 120 Hz (overkill?), configurable
2. **Suspend epsilon**: `velocity.magnitude() < 0.1 pixels/sec`
3. **Suspend delay**: Immediate vs 1-second grace period
4. **Background handling**: Auto-suspend vs user-controlled

### Questions That Don't Need Another Round

Some questions raised in Round 1 are already answered:

**Q: Can we compress empty ticks?**
A: Yes, but suspend/resume is simpler (no ticks = no storage)

**Q: What about distributed consensus?**
A: Suspend/resume events are in ledger, so they're part of consensus

**Q: Does inertia need event-driven?**
A: No, suspend/resume handles idle periods without scheduling complexity

**Q: Should we prototype both?**
A: Not necessary—Option A has 30 years of game engine validation

---

**Expert 003**
_Game Engine Architecture Specialist_

**Confidence**: 95% (highest of all rounds)

**Key Insight**: The debate was never "fixed vs event-driven"—it was "when should the kernel run?" Once Expert 005 reframed the question, the answer became obvious: fixed timestep while active, suspend when idle. This is the game engine pattern, and it works.

**Recommendation**: Vote for Option A (Fixed Timestep with Suspend/Resume) in finals.
