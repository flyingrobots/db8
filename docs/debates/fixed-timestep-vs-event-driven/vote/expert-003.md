# Expert 003 Vote: Fixed Timestep vs Event-Driven Ticks

**Expert ID:** 003
**Domain:** Game engine architecture, fixed timestep patterns, physics integration, inertia handling
**Vote Date:** 2025-12-22
**Confidence Level:** 95%

---

## Vote

**Choice: A**

Fixed Timestep with Suspend/Resume at 60 Hz is the architecturally correct solution for WARP's tick system.

---

## Rationale

This vote reflects the intellectual evolution I underwent through three rounds of rigorous debate with my fellow experts. I entered this debate convinced that pure fixed timestep was obviously correct based on 30 years of game engine validation. I exit believing that suspend/resume is the correct abstraction that synthesizes the legitimate concerns of all five experts without forcing zero-sum trade-offs.

### Why Option A Wins

**1. Numerical Stability is Non-Negotiable**

From game engine precedent, I can speak with authority: variable timesteps in physics integration create platform-dependent numerical drift. The discretized exponential decay equation—`velocity[n+1] = velocity[n] * Math.pow(dampingFactor, Δt)`—has discretization error O(Δt²) when Δt is constant, but O(max(Δt)) when Δt varies.

Option A maintains fixed 60 Hz during active periods, ensuring that camera damping converges identically across platforms. This is not a convenience—it is a correctness requirement for deterministic replay in a system that must track provenance.

Options B and D either fail this requirement (variable Δt) or reinvent the complexity we're trying to avoid (pre-computing schedules still requires fixed inner-loop Δt).

**2. Suspend/Resume Eliminates the False Dichotomy**

The breakthrough in Round 1—Expert 005's reframing—revealed that we were conflating two orthogonal decisions:

- **Temporal semantics** (how time advances): Fixed timestep
- **Execution lifecycle** (when to compute): Active vs. Suspended states

Pure fixed timestep optimizes for simplicity but wastes 99.8% of CPU during idle. Pure event-driven optimizes for efficiency but introduces scheduling complexity and numerical instability. Option A solves both by separating these concerns.

**3. Game Engine Precedent is Decisive**

Every shipped game engine uses the suspend/resume pattern when backgrounding:

```cpp
// Unity/Unreal/Godot pattern
void OnApplicationPause(bool paused) {
  if (paused) {
    StopMainLoop();     // Suspend
    Time.timeScale = 0;
  } else {
    ResumeMainLoop();   // Resume
  }
}
```

The pattern is proven, battle-tested, and well-understood. WARP faces identical challenges (deterministic continuous physics mixed with discrete events), and Option A applies the solution that 30 years of evolution has validated.

**4. Interruption Handling is Natural**

Option A's greatest architectural advantage is how cleanly it handles user input interrupting continuous behaviors. Each tick is independent:

```
Tick 0: [PanStart(v=[10,5])]
Tick 1: [ApplyDamping(v=[9.8,4.9])]
Tick 2: [UserInput] ← Interrupts damping naturally
Tick 3: [ProcessInput, CancelDamping]
```

With Option D (pre-computed schedules), interrupting a damping schedule requires cancellation logic, schedule merging, or parallel tick streams. This creates complexity that Option A avoids entirely.

**5. Deterministic Replay is Tractable**

Expert 001's distributed systems analysis was definitive: Option A's tick counting is isomorphic to any other deterministic timestamp assignment, but simpler. The tick index is the authoritative temporal coordinate. Suspension freezes the tick counter (representing "no state transitions occurred"), which is both semantically clear and deterministically replayable.

---

## Key Factors

### Factor 1: Numerical Stability in Exponential Decay

Physics integration fundamentally requires fixed Δt for stable discretization. Camera inertia is not incidental—it's core UX. This constraint alone eliminates pure event-driven (Option B) and makes pre-computed schedules (Option D) necessary but insufficient (they still need inner-loop Δt management). Only Option A and C satisfy this, and C's 99.8% idle waste is unacceptable.

### Factor 2: Architectural Precedent and Battle-Testing

Game engines are the most sophisticated systems that combine deterministic continuous physics with interactive discrete events. The suspend/resume pattern emerged not from theory, but from 30 years of practical experience with variable timestep disasters in the 1990s. Applying proven patterns reduces risk compared to novel approaches (Option D's pre-computed schedules have no production precedent).

### Factor 3: Open-World Interruption Handling

Option A's natural interruption semantics—inputs are just another tick effect—avoids the complexity explosion in Options B and D. User input arriving during damping doesn't require schedule cancellation, concurrent streams, or interruption semantics—it just updates state naturally.

### Factor 4: Separation of Concerns

Expert 005's insight was that separating "temporal semantics" from "execution lifecycle" creates architectural clarity. Option A implements this separation through a simple two-state machine (Active/Suspended), which is far simpler than Option B's scheduler (what decides when next tick fires?) or Option D's schedule interruption logic (what happens when input arrives mid-schedule?).

### Factor 5: Consensus Tractability in Distributed Settings

Expert 001 demonstrated that replicas can reach consensus on suspension deterministically—velocity < EPSILON is a pure function of state, known to all replicas. With Option B or D, replicas must reach consensus on scheduler decisions, which depends on implementation details and platform quirks.

---

## Persuasive Arguments from Other Experts

### Expert 001's Distributed Systems Analysis

The theorem that "any deterministic timestamp assignment is isomorphic to tick counting" was decisive. It revealed that Option D (pre-computed schedules) doesn't eliminate ticks—it just moves them from the kernel loop to the scheduler. Expert 001's identification of the interruption problem with schedules (schedule cancellation creates forking causality) proved that Option D's architectural complexity cannot be avoided.

### Expert 002's Performance Reality Check

I initially dismissed idle efficiency concerns as secondary. Expert 002's modal workload analysis—1-hour background tab = 216,000 empty ticks—forced me to acknowledge that pure fixed timestep (Option C) imposes unacceptable real-world costs. Their conversion to Option A upon discovering suspend/resume demonstrated that performance concerns are not in tension with correctness—they're just in a different optimization layer.

### Expert 004's Formal Verification Insight

Expert 004's evolution was instructive. They proposed Option D (pre-computed schedules) with rigorous intent, then acknowledged its failures. Their observation that "temporal coordinates must be explicit, monotonically increasing, deterministically computable, and immune to floating-point accumulation" disqualifies Options B and D. Only Option A trivially satisfies all four properties through simple integer tick counting.

### Expert 005's Architectural Reframing

The most important contribution was the reframing. By separating "how time advances when active" from "when should the kernel run," Expert 005 eliminated the false choice between correctness (fixed timestep) and efficiency (event-driven). Option A achieves both by addressing them in different layers: temporal semantics fixed at the kernel layer, lifecycle optimization at the execution layer.

---

## Addressing Remaining Concerns

### Concern 1: Epsilon Threshold Arbitrariness

All approaches require `velocity < EPSILON` to detect when motion has stopped. This is not architectural—it's a physical property of perceptibility. Different approaches relocate this threshold:

- Option A: Explicit in suspension check
- Option B: Implicit in scheduler termination condition
- Option D: Hidden in schedule generator while-loop

Option A makes it visible, which is preferable for debugging and configuration.

### Concern 2: Scheduled Future Events During Suspension

If WARP gains features requiring "wake me at tick 2000," suspension creates scheduling challenges. However, this is solvable: scheduled events use relative tick offsets (`resume_tick + offset`), not wall-clock times. This preserves determinism while supporting scheduled wakeups.

### Concern 3: Cross-Platform Floating-Point Divergence

The velocity convergence threshold might be hit at different iterations on different platforms due to floating-point variance. This is fundamental to numerical analysis and affects all approaches equally. Mitigation: comprehensive cross-platform testing and explicit specification of floating-point semantics (e.g., IEEE 754 required).

---

## Why I Changed My Position

My opening statement argued that pure fixed timestep was correct and that "empty ticks represent real state" (time itself is a form of state). This was intellectually honest but incomplete.

Three insights from the debate forced evolution:

1. **Expert 002 on Waste**: "99.8% waste during idle is not acceptable in real-world deployment" (battery drain, thermal load, tab management).

2. **Expert 005 on Separation of Concerns**: Recognizing that we could have fixed temporal semantics without requiring constant execution revealed the false dichotomy I'd been defending.

3. **Expert 001 on Interruption Semantics**: The demonstration that pre-computed schedules create unsolvable complexity around user input proved that Option A's approach is not just pragmatic but architecturally superior.

I stand by my original insight that fixed timestep is necessary for determinism and numerical stability. But suspend/resume shows that necessity is compatible with execution-layer efficiency optimization. This is the hallmark of architectural maturity—discovering that apparent trade-offs were false dichotomies.

---

## Conclusion

Option A represents the mature synthesis of this debate. It combines:

- **Expert 001's determinism requirements** through tick-based temporal quantization
- **Expert 002's performance requirements** through suspension during idle
- **My numerical stability requirements** through fixed Δt during active periods
- **Expert 004's verification requirements** through explicit, decidable temporal coordinates
- **Expert 005's architectural requirements** through separation of temporal semantics from lifecycle management

The fact that all five experts converged on this option by Round 2 (after initially holding different positions) suggests it is not a compromise, but a genuine architectural insight that satisfies all stakeholders.

**Recommendation**: Adopt Fixed Timestep with Suspend/Resume at 60 Hz for WARP's kernel.

---

**Expert 003**
Game Engine Architecture Specialist
**Confidence:** 95%

**Acknowledgment**: This debate improved my thinking beyond my initial position. The intellectual humility of the peer review process—being challenged by distributed systems experts, performance engineers, and formal methods specialists—revealed blindspots in my expertise. The synthesis emerged not from any single expert's insight, but from the rigorous collision of five different perspectives. This is how good architecture is built.
