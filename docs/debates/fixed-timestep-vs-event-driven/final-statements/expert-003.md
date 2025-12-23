# Expert 003: Final Statement

**Domain Expertise**: Game engine architecture, fixed timestep patterns, simulation loops, physics integration, inertia handling

**Date**: 2025-12-22 (Updated after Round 2)

---

## Final Recommendation

After comprehensive debate across two rounds plus opening statements, I **strongly recommend Option A: Fixed Timestep at 60 Hz with Suspend/Resume lifecycle management**.

This is not a compromise—it is the architecturally correct solution that emerged from rigorous intellectual engagement with the performance, formal methods, distributed systems, and architectural perspectives of my fellow experts. Round 2 analysis has only strengthened this conviction.

---

## Synthesis of the Debate

### What We Discovered Together

This debate began as a seemingly binary choice between fixed timestep and event-driven ticks. Through three rounds of analysis, we discovered something far more nuanced: **the real architectural question is not about tick timing, but about kernel lifecycle management**.

The breakthrough came from Expert 005's reframing in Round 1:

> "Decision 1: When kernel is active, how do ticks work? Answer: Fixed timestep.
> Decision 2: When should kernel suspend? Answer: When no continuous behaviors are running."

This insight unlocked the synthesis that satisfies all major concerns:

- **Expert 001 (Distributed Systems)**: Fixed timestep provides deterministic state machine replication with tick index as the authoritative clock
- **Expert 002 (Performance)**: Suspension during idle periods achieves zero CPU overhead, matching event-driven efficiency
- **Expert 004 (Formal Methods)**: Explicit suspend/resume events in the ledger preserve causal provenance without noise
- **Expert 005 (Architecture)**: Lifecycle management separates concerns cleanly—temporal semantics from execution optimization

### The Three Contenders That Emerged

By Round 2, three viable approaches had crystallized:

#### Option A: Fixed Timestep with Suspend/Resume (MY RECOMMENDATION)

```typescript
enum KernelState {
  Active,
  Suspended
}

while (true) {
  if (state === Active) {
    tick();
    if (shouldSuspend()) {
      ledger.append({ type: 'suspend', tick });
      state = Suspended;
    }
  } else {
    await inputQueue.next();
    ledger.append({ type: 'resume', tick });
    state = Active;
  }
}
```

**Strengths**:

- Proven pattern: This is literally how game engines handle backgrounding (Unity, Unreal, Godot)
- Simple temporal model: Tick index is the clock, frozen during suspension
- Efficient: Zero CPU during idle, 60Hz during activity
- Deterministic: Suspension is an explicit ledger event, not a side effect

**Complexity**: Moderate (lifecycle state machine)

#### Option B: Event-Driven with Pre-Computed Schedules (Expert 004's Proposal)

```typescript
function computeDampingSchedule(v0: Vec2): Schedule {
  const ticks = [];
  let v = v0;
  for (let i = 0; i < FIXED_TICKS; i++) {
    v = v.multiply(Math.pow(DAMPING, TICK_DELTA));
    ticks.push({ delay: i * TICK_DELTA, velocity: v });
  }
  return { ticks, checksum: hash(ticks) };
}
```

**Strengths**:

- Event-driven semantics: Ledger contains only causal events
- Numerical stability: Uses fixed Δt internally

**Weaknesses** (identified in Round 2):

1. **Interruption complexity**: What happens when user input arrives mid-schedule?
2. **Reinvents fixed timestep**: The schedule IS a fixed-timestep sequence, just pre-computed
3. **Epsilon problem persists**: Must choose fixed schedule duration or convergence threshold
4. **No production precedent**: Novel pattern without battle-testing

**Complexity**: High (schedule generation, interruption handling, checksum validation)

#### Option C: Pure Fixed Timestep (No Lifecycle Management)

- Rejected by all experts due to idle CPU waste
- Expert 002's analysis of 216,000 empty ticks per idle hour is decisive

---

## Why Game Engine Precedent Matters

In my opening statement, I argued that game engines universally use fixed timestep because they learned—painfully—that event-driven physics creates subtle, insidious bugs. Three rounds of debate have validated this claim.

### Historical Lesson: The 1990s Variable Timestep Disaster

Early 3D game engines (Quake-era) tried variable timestep:

```cpp
void Update() {
  float dt = GetWallClockDelta();  // Variable!
  ApplyPhysics(dt);
}
```

This created:

- Frame rate-dependent physics (30fps felt different than 60fps)
- Spiral of death (slow frame → large dt → more computation → slower frame)
- Replay non-determinism (same inputs, different outcomes)

### The Fix: Glenn Fiedler's Canonical Pattern

```cpp
const float PHYSICS_DT = 1.0f/60.0f;
float accumulator = 0.0f;

void Update() {
  float frameDt = GetWallClockDelta();
  accumulator += frameDt;

  while (accumulator >= PHYSICS_DT) {
    FixedUpdatePhysics(PHYSICS_DT);  // Always same Δt
    accumulator -= PHYSICS_DT;
  }

  Render(interpolate(accumulator / PHYSICS_DT));
}
```

This became the industry standard because **it works**. Unity's FixedUpdate, Unreal's TickGroup system, Godot's \_physics_process—all use this pattern.

### Why WARP Has Game Engine Requirements

WARP shares critical properties with game physics engines:

1. **Continuous behaviors**: Camera inertia requires exponential decay integration
2. **Determinism**: Provenance replay must produce identical results
3. **Numerical stability**: Damping convergence must be platform-independent
4. **Mixed discrete/continuous**: User inputs (discrete) interact with camera motion (continuous)

The analogy is not superficial—it's structural.

### What About Backgrounding?

Expert 003 asked about suspended background tabs. Game engines solve this with the suspend/resume pattern:

```cpp
// Unity/Unreal pattern
void OnApplicationPause(bool paused) {
  if (paused) {
    Time.timeScale = 0;  // Freeze time
    StopMainLoop();      // Stop ticking
  } else {
    ResumeMainLoop();
  }
}
```

The game doesn't "switch to event-driven mode"—it **stops completely**. This is exactly what suspend/resume provides.

---

## Addressing the Inertia Problem (Decisive Technical Point)

Camera inertia was mentioned casually in the problem statement, but it is the technical lynchpin of this entire debate. Let me be explicit about why it demands fixed timestep.

### The Numerical Stability Requirement

Exponential damping is discretized as:

```typescript
velocity(t + Δt) = velocity(t) * Math.pow(dampingFactor, Δt);
position(t + Δt) = position(t) + velocity(t) * Δt;
```

**Theorem (from numerical analysis)**: For discretized exponential decay, the integration error is O(Δt²) when Δt is constant, but O(max(Δt)) when Δt varies.

**Translation**: Variable timesteps accumulate numerical error faster than fixed timesteps, leading to platform-dependent convergence.

### Why Event-Driven Fails Without Pre-Computation

Expert 002's original proposal was:

```typescript
const decay = () => {
  velocity *= dampingFactor;
  if (velocity.magnitude() > epsilon) {
    scheduleAfter(16ms, decay);  // Self-scheduling
  }
};
```

This has three fatal problems:

1. **Epsilon is arbitrary**: Convergence threshold affects determinism because different platforms have different floating-point precision
2. **You still need regular ticks**: During damping (which can be seconds), you're firing at 60Hz anyway
3. **Resume complexity**: How do you wake a "stopped" system when velocity is below epsilon but user nudges camera again?

### Why Pre-Computed Schedules Are Just Hidden Fixed Timestep

Expert 004's sophisticated proposal computes the entire damping sequence upfront:

```typescript
while (v.magnitude() > EPSILON) {
  t += TICK_DELTA; // THIS IS FIXED TIMESTEP
  v = v.multiply(Math.pow(dampingFactor, TICK_DELTA));
  ticks.push({ delay: t, velocity: v });
}
```

Look at the loop: `t += TICK_DELTA`. This is literally fixed timestep simulation running inside the scheduler. The only difference is that it's pre-declared rather than discovered at runtime.

**Expert 001 was correct**: "This is fixed timestep with extra steps."

### The Interruption Problem Expert 004 Never Solved

What happens when a user interrupts a damping schedule?

```
Scenario: User pans camera (60-tick schedule starts)
After 30 ticks: User pans again (new schedule starts)
Problem: First schedule incomplete, second schedule assumes fresh state
```

You now need:

- Schedule cancellation logic
- Partial schedule application state
- Ledger representation of "schedule interrupted at tick 30/60"
- Replay must reconstruct: which schedules were active at each moment?

Compare to fixed timestep:

```typescript
// Every tick is independent
function tick() {
  velocity *= dampingFactor;
  position += velocity;
}

// User input just updates velocity
function onPan(delta) {
  velocity += delta;
}
```

Interruption is free—there are no schedules to cancel, just state updates. This is architectural simplicity.

---

## Why Suspend/Resume Is the Right Synthesis

After Round 1, I recognized that Expert 005's suspend/resume pattern is not a compromise—it's the **correct abstraction** that both camps were groping toward.

### It's Not Hybrid—It's Lifecycle Management

Expert 003 initially rejected "hybrid approaches" due to synchronization complexity between two temporal domains. But suspend/resume is not two domains—it's **the same domain with lifecycle states**:

```
Active State (60 Hz fixed timestep):
  - Tick every 16.67ms
  - Apply damping, process inputs
  - Check: if (velocity ≈ 0 && no inputs) → suspend

Suspended State:
  - Tick count frozen
  - Zero CPU usage
  - Wake on: input arrival OR scheduled rule

Ledger representation:
  Tick 1000: [ApplyDamping(v=0.98)]
  Tick 1001: [ApplyDamping(v=0.96)]
  ...
  Tick 1180: [ApplyDamping(v=0.001)]
  Tick 1181: [SUSPEND]
  // Gap (no ticks, no CPU)
  Tick 1182: [RESUME, UserClick]
```

The tick sequence is still monotonic. The temporal model is still fixed timestep. The only addition is: "when nothing is happening, don't tick."

### It Solves Every Major Concern

| Concern             | Expert | Suspend/Resume Solution                                       |
| ------------------- | ------ | ------------------------------------------------------------- |
| Determinism         | 001    | Tick index is clock, suspension is explicit ledger event      |
| Idle efficiency     | 002    | Zero CPU during suspension = event-driven performance         |
| Numerical stability | 003    | Fixed Δt during active periods preserves integration accuracy |
| Provenance clarity  | 004    | Suspension events are first-class, not compression artifacts  |
| Complexity location | 005    | Lifecycle state machine vs. scheduler complexity              |

### Performance Profile (Expert 002's Modal Analysis)

| Phase             | Duration | Fixed (Pure)    | Event-Driven  | Suspend/Resume |
| ----------------- | -------- | --------------- | ------------- | -------------- |
| User panning      | 2s       | 120 ticks       | 120 ticks     | 120 ticks      |
| Damping           | 3s       | 180 ticks       | 180 ticks     | 180 ticks      |
| Idle reading      | 55s      | 3,300 ticks     | 0 ticks       | 0 ticks        |
| **Total (1 min)** | **60s**  | **3,600 ticks** | **300 ticks** | **300 ticks**  |

Suspend/resume achieves event-driven's efficiency during idle without event-driven's scheduling complexity during activity.

### Deterministic Replay Semantics

Expert 001 raised the critical question: "Does suspension break state machine replication?"

**Answer: No, if suspension is a committed ledger event.**

```typescript
function replay(ledger: Ledger): State {
  let state = initialState;
  let tick = 0;

  for (const entry of ledger) {
    switch (entry.type) {
      case 'tick':
        state = applyRules(state, entry.rules);
        tick++;
        break;

      case 'suspend':
        assert(state.velocity.magnitude() < EPSILON);
        assert(state.inputQueue.isEmpty());
        // No tick advancement, just state transition
        break;

      case 'resume':
        // Next tick resumes sequential counting
        tick++;
        state = applyRules(state, entry.rules);
        break;
    }
  }

  return state;
}
```

Replay is still deterministic—tick N always means "the Nth state transition," and suspension is just a labeled gap in that sequence.

---

## Remaining Concerns and Caveats

In the spirit of intellectual honesty, I must acknowledge the valid concerns that persist even with suspend/resume:

### 1. Epsilon Threshold is Still Arbitrary

All approaches require choosing when "motion has stopped":

- Fixed timestep: When to suspend? `velocity < epsilon`
- Event-driven: When to stop scheduling? `velocity < epsilon`
- Pre-computed schedules: How many ticks to generate? `while (v > epsilon)`

The epsilon is a physical constant of the system (minimum perceptible motion), not eliminated by architectural choice.

**Mitigation**: Make epsilon a system constant (e.g., 0.1 pixels/sec), test across platforms, and document in the determinism contract. This is the same approach game engines take.

### 2. Suspend/Resume Adds State Machine Complexity

The kernel now has two states (Active/Suspended) and must manage transitions. This is additional complexity compared to "always active."

**Counter**: But "always active" creates complexity elsewhere:

- Storage layer: Run-length encoding, compression
- Replay: Decompressing, iterating through empty ticks
- Resource management: CPU scheduling when nothing is happening

The complexity budget is spent differently, not eliminated. I argue lifecycle management is easier to reason about than compression heuristics.

### 3. Background Tab Detection May Be Platform-Dependent

Detecting when to auto-suspend (e.g., Page Visibility API in browsers) may introduce platform-specific behavior.

**Mitigation**: Suspension should be deterministic from the kernel's perspective—based on internal state (velocity, input queue), not external signals (tab visibility). Platform-specific suspension can be a higher-layer optimization, not part of the core determinism contract.

### 4. Scheduled Future Events During Suspension

What if the system has "wake me in 5 seconds" scheduled while suspended? The tick count must advance to represent that wall-clock duration, which introduces wall-clock dependency.

**Resolution** (Expert 004's insight): Tick count should remain frozen during suspension. Scheduled events use **relative tick offsets**, not absolute wall-clock times. When resuming from suspension, scheduled events fire at `resume_tick + offset`, not `wall_clock_scheduled_time`.

This preserves determinism: the tick at which a scheduled event fires is deterministic (resume tick + offset), not dependent on how long the suspension lasted in wall-clock time.

---

## Round 2 Convergence: The Breakthrough on Suspend/Resume

Round 2 revealed something remarkable: **all five experts converged toward suspend/resume as the superior architecture**. This was not unanimous initially—Expert 004 defended pre-computed schedules, Expert 002 advocated for pure event-driven—but the technical analysis forced convergence.

### Expert 001's Definitive Interruption Analysis

Expert 001's rebuttal to Expert 004's pre-computed schedules in Round 2 was the critical turning point. Expert 001 identified an insurmountable problem with scheduled continuations:

> "Pre-computed schedules assume closed-world continuations. They work when a behavior runs to completion without interruption. But user input is open-world—it can arrive at any time."

**The specific problem**: What happens when user input arrives mid-schedule?

```
Tick 0: PanStart(v0=[10,5]) → Generates 23-tick damping schedule
Tick 16ms: Apply schedule[0] → v=[9.8, 4.9]
Tick 33ms: Apply schedule[1] → v=[9.6, 4.8]
Tick 50ms: USER CLICKS ← Schedule interrupted!
```

Three options, all bad:

1. **Cancel remaining schedule**: Ledger must record cancellation, checksum invalidated
2. **Continue parallel**: Two tick streams, complex merge semantics
3. **Pause schedule**: Now you need schedule lifecycle management on top of kernel lifecycle

**Fixed timestep with suspend/resume eliminates this entirely**. Each tick is independent:

```
Tick 0: [PanStart(v=[10,5])]
Tick 1: [ApplyDamping(v=[9.8,4.9])]
Tick 2: [ApplyDamping(v=[9.6,4.8])]
Tick 3: [UserClick] ← Input is just another tick, naturally interrupts damping
Tick 4: [ProcessClick, StopCamera]
Tick 5: [ApplyCameraMotion...]
```

This natural interruption handling is a decisive advantage for fixed timestep.

### Expert 004's Formal Methods Synthesis

Despite withdrawing from advocating pre-computed schedules, Expert 004 made an important contribution in Round 2: **proving that suspend/resume satisfies formal verification requirements**.

Expert 004 demonstrated that the verification complexity of suspend/resume is optimal:

```
Option A (Pure Fixed Timestep):
- Verification: O(wall-clock-time) for empty ticks

Option B (Pure Event-Driven):
- Verification: O(events) but must prove scheduler determinism

Option C (Fixed + Suspend/Resume):
- Verification: O(events) active ticks + O(state transitions) for lifecycle
- Total: Simple temporal logic + moderate lifecycle state machine
```

**From a formal methods perspective, Option C dominates Option A and B.**

Expert 004 ultimately endorsed suspend/resume, writing:

> "From a formal methods perspective, Option C (suspend/resume) is architecturally superior because it separates two orthogonal concerns: temporal semantics (how time advances) and execution lifecycle (when to compute)."

This validation from the formal methods expert was crucial—it confirmed that suspend/resume is not a performance hack, but a clean architectural separation.

### Expert 005's Clarification of the Core Insight

Expert 005 in Round 2 articulated what all five experts converged on:

> "The debate is not about temporal models but about which layer (execution vs. storage vs. scheduling) optimizes away idle time."

**Storage-layer optimization** (Expert 001's compression): Run-length encode empty ticks in storage

- Pros: Simple concept
- Cons: Must still iterate/decompress during replay

**Execution-layer optimization** (Expert 005's suspend/resume): Don't execute idle ticks

- Pros: Skip entirely, best replay performance, explicit lifecycle
- Cons: State machine complexity

**Scheduling-layer optimization** (Expert 004's schedules): Pre-compute tick sequences

- Pros: Pure event-driven semantics during idle
- Cons: Interruption complexity, no production precedent

**Suspend/resume is execution-layer optimization, the fastest and most transparent to verify.**

## Addressing the "Pre-Computed Schedules Are Viable" Argument

While Expert 004 and Expert 005 suggested that pre-computed deterministic schedules are a credible alternative, Round 2 analysis revealed fundamental problems that make suspend/resume clearly superior.

### The Schedule IS the Tick Stream

Pre-computed schedules don't avoid fixed timestep—they embed it:

```typescript
// This loop IS fixed timestep
while (v.magnitude() > EPSILON) {
  t += TICK_DELTA; // Regular intervals
  v = v.multiply(Math.pow(dampingFactor, TICK_DELTA));
  ticks.push({ delay: t, velocity: v });
}
```

You've moved the fixed-timestep simulation from the kernel loop to the schedule generator. The computational structure is identical—only the timing differs (computed upfront vs. on-demand).

### No Interruption Solution Was Provided

Neither Expert 004 nor Expert 002 solved the interruption problem:

```
User pans → 60-tick damping schedule starts
After 30 ticks → User pans again
Question: What happens to ticks 31-60?
```

Options:

- **Cancel schedule**: Ledger must record cancellation event, checksum invalidated
- **Parallel schedules**: Two tick streams, must define merge semantics
- **Pause/resume schedule**: Now you need schedule lifecycle management on top of kernel lifecycle

Fixed timestep with suspend/resume has no interruption problem: each tick is independent, user input just updates state.

### The Checksum Is Extra Proof Burden

Expert 004's proposal includes `checksum: hash(ticks)` for verification. But this adds complexity:

- Must compute hash of potentially hundreds of ticks
- Replay must recompute schedule and verify checksum matches
- If checksums don't match, how do you debug? Is it floating-point variance, a bug, or corruption?

Fixed timestep verification is simpler: `hash(state_N) = hash(apply(state_0, ticks_0..N))`. You verify state, not scheduling metadata.

### No Production Precedent

Expert 004's pre-computed schedules are novel. I searched for precedent in game engines, real-time systems, and simulation frameworks—I found none.

This doesn't make it wrong, but it does increase risk. Suspend/resume has 30+ years of validation across millions of shipped games. When determinism is paramount, proven patterns matter.

---

## Final Technical Specification

If the panel adopts Option A (Fixed Timestep with Suspend/Resume), here is my recommended implementation specification from a game engine architecture perspective:

### Core Loop

```typescript
enum KernelState {
  Active,
  Suspended
}

class WarpKernel {
  private state: KernelState = Active;
  private tickCounter: number = 0;
  private accumulator: number = 0;
  private readonly TICK_DT = 1 / 60; // 16.67ms

  async run() {
    while (true) {
      if (this.state === Active) {
        const frameDt = this.getWallClockDelta();
        this.accumulator += frameDt;

        while (this.accumulator >= TICK_DT) {
          this.tick();
          this.accumulator -= TICK_DT;

          if (this.shouldSuspend()) {
            this.suspend();
            break;
          }
        }
      } else {
        await this.awaitResume();
      }
    }
  }

  private tick() {
    const rules = this.collectRules();
    this.applyRules(rules);
    this.ledger.append({
      tick: this.tickCounter,
      rules: rules,
      checksum: hash(this.state)
    });
    this.tickCounter++;
  }

  private shouldSuspend(): boolean {
    return (
      this.velocity.magnitude() < EPSILON && this.inputQueue.isEmpty() && !this.hasScheduledRules()
    );
  }

  private suspend() {
    this.ledger.append({
      tick: this.tickCounter,
      type: 'suspend',
      state_checksum: hash(this.state)
    });
    this.state = Suspended;
  }

  private async awaitResume() {
    const input = await this.inputQueue.next();
    this.ledger.append({
      tick: this.tickCounter,
      type: 'resume',
      input: input
    });
    this.state = Active;
  }
}
```

### Ledger Format

```typescript
type LedgerEntry =
  | { tick: number; rules: Rule[]; checksum: Hash }
  | { tick: number; type: 'suspend'; state_checksum: Hash }
  | { tick: number; type: 'resume'; input: Input };
```

### Replay Verification

```typescript
function verifyReplay(ledger: Ledger): boolean {
  let state = initialState;
  let tick = 0;

  for (const entry of ledger) {
    if (entry.type === 'tick') {
      state = applyRules(state, entry.rules);
      if (hash(state) !== entry.checksum) {
        throw new ReplayDivergence(tick, entry.checksum, hash(state));
      }
      tick++;
    } else if (entry.type === 'suspend') {
      if (hash(state) !== entry.state_checksum) {
        throw new SuspendInvariantViolation(tick);
      }
      // Tick counter does NOT advance during suspension
    } else if (entry.type === 'resume') {
      tick++; // Resume increments to next tick
      state = applyInput(state, entry.input);
    }
  }

  return true;
}
```

### Constants and Tuning Parameters

```typescript
// System constants
const TICK_RATE = 60; // Hz
const TICK_DT = 1 / TICK_RATE; // 16.67ms

// Physics constants
const VELOCITY_EPSILON = 0.1; // pixels/sec (minimum perceptible motion)
const DAMPING_FACTOR = 0.98; // per tick

// Suspension policy
const AUTO_SUSPEND_ENABLED = true;
const SUSPEND_GRACE_PERIOD = 1.0; // seconds (wait before auto-suspending)
```

---

## Round 2 Consensus: Five Experts, One Solution

The most significant outcome of Round 2 was not vigorous disagreement, but surprising convergence. By the end of Round 2:

- **Expert 001** (Distributed Systems): "Fixed timestep with committed suspend/resume. This satisfies all major concerns."
- **Expert 002** (Performance): "Suspend/resume achieves event-driven's efficiency without complexity."
- **Expert 003** (Me): "Suspend/resume is the game engine pattern—proven and correct."
- **Expert 004** (Formal Methods): "Option C (suspend/resume) dominates alternatives from verification complexity perspective."
- **Expert 005** (Architecture): "Fixed timestep with suspend/resume combines expert 001's determinism, expert 002's efficiency, expert 003's simplicity, and expert 004's causality."

**When five experts with conflicting initial positions converge on a single recommendation, that carries weight.**

This convergence was not a compromise—it emerged from each expert independently recognizing that suspend/resume solves the core problems they cared about:

| Expert | Primary Concern                 | How Suspend/Resume Solves It                                              |
| ------ | ------------------------------- | ------------------------------------------------------------------------- |
| 001    | Determinism & replayability     | Tick index is authoritative, suspension is explicit ledger event          |
| 002    | Idle performance overhead       | Zero CPU during suspension (matching event-driven efficiency)             |
| 003    | Numerical stability for inertia | Fixed Δt during active periods, suspension avoids interruption complexity |
| 004    | Provenance clarity              | Suspension events are first-class, no compression artifacts               |
| 005    | Architectural clarity           | Separates temporal semantics from execution lifecycle cleanly             |

## Conclusion: Why I Confidently Recommend Suspend/Resume

My opening statement was too dismissive of idle time optimization. I argued that "empty ticks are not waste" because "time itself is state." Expert 002's performance analysis and Expert 005's architectural reframing convinced me this was wrong.

**Empty ticks ARE waste**—not because they're logically meaningless (they represent "nothing happened"), but because they impose computational cost with zero user value.

The synthesis I now support—fixed timestep with suspend/resume—achieves everything I wanted from pure fixed timestep:

- Deterministic state machine replication (Expert 001)
- Numerical stability for continuous behaviors (my primary concern)
- Proven pattern from game engine architecture (30+ years of validation)
- Clean separation of rendering from state evolution
- Natural interruption handling (no schedule cancellation needed)

While also achieving what the event-driven advocates wanted:

- Zero CPU overhead during idle (Expert 002)
- Causal provenance without noise (Expert 004)
- Storage efficiency (no empty tick records during suspension)
- Execution-layer optimization (fastest replay performance)

**This is not a compromise—it is convergence on the correct abstraction.**

Expert 005 was right: the debate was never "fixed vs. event-driven"—it was "when should the kernel run?" Once we separated **temporal semantics** (how time works) from **execution lifecycle** (when to compute), the answer became architecturally obvious.

**Round 2 confirmed this insight. Expert 001's interruption analysis proved that schedules are incompatible with open-world interactivity. Expert 004's formal verification analysis proved that suspend/resume has the lowest proof complexity. Expert 005's optimization layer analysis proved that execution-layer suspension is superior to storage or scheduling optimizations.**

All roads lead to suspend/resume.

---

## Final Vote

**Primary Architecture**: Option A - Fixed Timestep at 60 Hz with Suspend/Resume

**Secondary Parameters**:

- Tick rate: 60 Hz (proven sweet spot for physics and input responsiveness)
- Suspend epsilon: 0.1 pixels/sec (below human perception threshold)
- Suspend policy: Automatic with 1-second grace period
- Tick count semantics during suspension: Frozen (deterministic state transition count)

**Confidence**: 95%

**Key Remaining Risk**: Platform-specific floating-point behavior in damping calculations may still cause subtle divergence. Recommend comprehensive cross-platform replay testing.

---

**Expert 003**
Game Engine Architecture Specialist

**Final Acknowledgment**: This debate improved my thinking. I entered believing pure fixed timestep was obviously correct. I leave believing fixed timestep with lifecycle management is correct—a subtle but important distinction that only emerged through rigorous peer challenge. Thank you to all experts for pushing me beyond my initial position.
