# Expert 005 Vote: Fixed Timestep with Suspend/Resume

**Expert ID:** 005
**Domain:** Systems Architecture, Design Coherence, Complexity Management
**Date:** 2025-12-22
**Phase:** Final Vote

---

## Vote

**Choice**: **A - Fixed Timestep with Suspend/Resume (60 Hz)**

---

## Rationale

After studying all expert statements across three rounds of debate, I cast my vote for Option A with high confidence. This represents the architecturally superior solution that emerged from rigorous multi-disciplinary analysis.

The debate trajectory is instructive: we began with experts advocating four different approaches (pure fixed timestep, pure event-driven, run-length encoding, pre-computed schedules). Through three rounds of rigorous peer challenge, all five experts converged on Option A. **This unanimous convergence carries significant weight—it suggests we've found an equilibrium where each domain's core requirements are satisfied without unresolved conflicts.**

### Why Option A Dominates Alternatives

**Against Option B (Pure Event-Driven):**

- Expert 003's numerical stability analysis is decisive: variable Δt creates platform-dependent floating-point accumulation in camera damping
- Expert 001's scheduler complexity critique shows that deterministic scheduling is harder than fixed temporal quantization
- Expert 002 demonstrated that pure event-driven still requires O(events) ticking during continuous behaviors (600 ticks for 10s pan), so the complexity is not optional

**Against Option C (Run-Length Encoding):**

- Option A achieves the same determinism and efficiency with simpler execution model
- Pure fixed timestep consumes 216,000 CPU wakeups per idle hour—unacceptable for battery life and resource sharing
- Suspend/resume is simpler than compression heuristics and has proven precedent in OS kernel design

**Against Option D (Pre-Computed Schedules):**

- Expert 001's interruption analysis exposed a fundamental flaw: what happens when user input arrives mid-schedule? The proposed solutions (cancellation, parallel schedules, schedule pausing) each introduce complexity
- Expert 003 correctly identified that pre-computed schedules "reinvent fixed timestep with extra steps"—the schedule generation loop `t += TICK_DELTA` is literally fixed timestep simulation
- Expert 004's formal analysis showed that schedule checksums create an additional verification surface, compared to Option A's simpler state-based verification
- The epsilon problem is not solved by schedules—only relocated from "when to suspend" to "how many ticks to generate"

### Architectural Coherence

What distinguishes Option A is not just technical superiority but **architectural clarity**. The design separates two orthogonal concerns:

1. **Temporal semantics** (how time advances): Fixed 60 Hz timestep
2. **Execution lifecycle** (when to compute): Active/Suspended states

This separation eliminates the conceptual tension that plagued earlier positions. Pure fixed timestep forced us to accept idle waste as "logically necessary" (Expert 001's original position). Pure event-driven forced us to accept scheduling complexity as "necessary for efficiency" (Expert 002's original position). Suspend/resume reveals they were optimizing different layers—we can optimize execution lifecycle without changing temporal semantics.

**This is not compromise. It is synthesis.**

---

## Key Factors

1. **Unanimous Expert Convergence**: All five experts, starting from different positions and optimizing different concerns, independently concluded that Option A best satisfies their domain requirements. This convergence from initially diverse viewpoints provides strong evidence of architectural correctness.

2. **Proven Precedent**: Game engines (Unity, Unreal, Godot) use this pattern for 30+ years. OS kernels (Windows, Linux, macOS) use sleep/wake lifecycle management. When two independent domains converge on the same pattern, it suggests deep architectural validity.

3. **Eliminates False Tradeoff**: The debate revealed that "determinism vs. efficiency" was a false dichotomy. We don't need to choose between fixed timestep's correctness guarantees and event-driven's idle efficiency. Suspend/resume provides both without requiring the complexity of either pure approach.

4. **Performance Profile**: The efficiency analysis by Expert 002 is compelling. For a typical 10-minute session with 30 seconds of active interaction:
   - Pure fixed timestep: ~36,000 ticks, 99% waste
   - Option A: ~300 active ticks + suspend/resume events, ~1% waste
   - This matches event-driven efficiency while retaining fixed timestep's determinism

5. **Numerical Stability**: Expert 003's physics integration argument is airtight. Camera damping `v[n+1] = v[n] * damping^Δt` only produces deterministic results with constant Δt. This is not optional—it's a correctness requirement for any system with continuous behaviors.

6. **Formal Tractability**: Expert 004's formal methods analysis demonstrates that suspend/resume creates O(events) proof complexity for temporal reasoning, compared to O(wall-clock-time) for pure fixed timestep. This is not a minor optimization—it fundamentally changes what's formally verifiable.

7. **Interruption Handling**: The natural interruption semantics of fixed timestep (each tick is independent, inputs just update state) is vastly superior to schedule-based approaches. Expert 001's identification of the interruption problem in pre-computed schedules was decisive—it revealed a fundamental architectural flaw.

---

## Persuasive Arguments from Other Experts

**Expert 001's Core Insight:**
"Any deterministic timestamp assignment is isomorphic to tick counting."

This proved decisive in rejecting pure event-driven approaches. It revealed that event-driven systems do not eliminate temporal quantization—they merely relocate it from the kernel loop to the scheduler. Pre-computed schedules exemplify this: they compute `t_i = t_0 + i * Δt`, which is fixed timestep embedded in data. Once we recognize this fundamental isomorphism, the question becomes: where is it cleaner to put temporal quantization? The kernel loop (explicit and simple) or the scheduler (complex and fragile)?

**Expert 002's Performance Analysis:**
The modal use case analysis was devastating to pure fixed timestep:

- 1 hour idle = 216,000 empty ticks
- CPU wakeups burn battery on mobile
- Provenance audits wade through 99.8% noise
- Replay latency is user-facing

This forced the debate away from "pure fixed timestep is obviously correct" into acknowledging that idle periods must be optimized. But Expert 002's evolution through the debate—from advocating pure event-driven to endorsing suspend/resume—demonstrates that the efficiency gains don't require scheduling complexity. Suspend/resume achieves event-driven efficiency at the execution layer rather than the scheduling layer, with lower complexity.

**Expert 003's Interruption Analysis (Round 2):**
The specific example of how user input during mid-schedule creates three equally-bad options (cancel schedule, parallel schedules, pause schedule) exposed that pre-computed schedules fundamentally misalign with open-world interactivity. Fixed timestep has no interruption problem—every tick is independent. This architectural advantage cannot be understated.

**Expert 004's Formal Verification Requirements:**
The shift from advocating pure event-driven to recognizing that temporal coordinates must be "explicit in the ledger, monotonically increasing, deterministically computable from the ledger alone, immune to floating-point accumulation" was crucial. Only fixed timestep tick indices satisfy all four requirements trivially. Pre-computed schedules violate requirements 1 and 3 (schedule checksum becomes part of verification surface).

**Expert 005's Layer Analysis:**
The recognition that the debate was stuck on "fixed vs. event-driven" because each camp was optimizing different layers (storage, scheduling, execution) was the breakthrough that unlocked suspend/resume. Once we separated "how time advances" from "when to advance time," the solution became clear. Suspend/resume optimizes at the execution layer (where it's simplest) rather than requiring storage compression or scheduling logic.

---

## How Option A Satisfies All Concerns

| Expert                    | Primary Concern                                                                  | How Option A Satisfies It                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001 (Distributed Systems) | Deterministic state machine replication with clear temporal semantics            | Tick index is explicit ledger entry and authoritative clock; suspend/resume are first-class ledger events; no wall-clock dependency in replay    |
| 002 (Performance)         | Zero CPU overhead during idle; efficient provenance audits                       | Suspension removes 99.9% of idle ticks; ledger contains O(events) entries during idle, not O(time)                                               |
| 003 (Game Engines)        | Numerical stability for continuous physics; interruption handling                | Fixed Δt = 16.67ms ensures O(Δt²) error bounds for damping integration; each tick independent, no schedule cancellation needed                   |
| 004 (Formal Methods)      | Explicit temporal coordinates; minimal proof complexity; formal compositionality | Tick indices are integers (no floating-point accumulation); suspension is observable state transition; verification scales O(events) not O(time) |
| 005 (Architecture)        | Clean separation of concerns; architectural coherence; proven precedent          | Distinct layers: temporal semantics (fixed 60Hz) vs. execution lifecycle (active/suspended); matches OS kernel and game engine patterns          |

---

## Remaining Uncertainties

I acknowledge 10% residual uncertainty in the following areas:

1. **Distributed Suspend/Resume Consensus**: Multi-replica suspension requires consensus, which adds latency. The interaction between immediate input responsiveness and consensus latency has not been fully explored. This is solvable but requires careful protocol design.

2. **Scheduled Future Rules**: If WARP supports "wake me in 5 seconds" rules, determining the exact tick at which they fire requires careful handling. The tick must be deterministic (not dependent on wall-clock suspension duration), but computing it requires scheduled rule tracking. This is solvable but adds complexity to the suspension condition.

3. **Epsilon Threshold Calibration**: The suspension epsilon affects UX (too high = abrupt stops, too low = long damping). The value is a physical constant that cannot be eliminated, but choosing the right value requires empirical testing across use cases. Different epsilon values yield different but internally-consistent behaviors.

4. **Platform-Specific Floating-Point Behavior**: Despite fixed Δt, different CPU architectures (x86 vs. ARM) might still exhibit subtle floating-point variance in damping calculations. Expert 003's concern about cross-platform numerical reproducibility remains valid and requires empirical validation.

---

## Conclusion

After synthesizing five expert perspectives across three rounds of debate, Option A emerges as the clear choice. It is not optimal in isolation (pure fixed timestep is simpler, pure event-driven is more philosophically elegant), but it dominates in holistic architectural terms: it satisfies all five experts' core requirements without unresolved conflicts.

The convergence of five initially-diverse experts on this solution provides strong evidence that we have found not just a workable compromise, but a genuinely superior architecture that each domain recognizes as serving its values better than the alternatives.

**Recommend WARP adopt Fixed Timestep with Suspend/Resume at 60 Hz.**

---

**Expert 005**
Systems Architecture, Design Coherence, Complexity Management

**Confidence:** 95%
**Status:** Final vote submitted
