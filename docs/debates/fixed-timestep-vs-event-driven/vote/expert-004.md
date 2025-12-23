# Expert 004 Vote: Fixed Timestep with Suspend/Resume

**Expert ID:** 004
**Domain:** Formal Methods, Provenance Tracking, Correctness Proofs
**Date:** 2025-12-22
**Voting Phase:** Final Expert Vote

---

## Vote

**Choice: A** - Fixed Timestep with Suspend/Resume (60 Hz)

---

## Rationale

After reviewing all five final statements and three rounds of debate, I cast my vote for Option A with high confidence. This represents the vindication of formal methods principles applied to temporal systems in deterministic environments.

### The Formal Methods Argument

From my domain's perspective, the critical insight is this: **in any system with provenance tracking and distributed replication, temporal coordinates are not implementation details—they are first-class formal objects that must be explicitly represented in the ledger.**

Any deterministic system requires:

1. **Explicit temporal coordinates** (not derived from other data)
2. **Monotonic advancement** across all replicas
3. **Deterministic computability** from the ledger alone
4. **Immunity to floating-point accumulation**

Fixed timestep with suspend/resume satisfies all four requirements trivially:

- Tick indices are explicit integers, monotonically increasing
- Suspension is a state transition observable in the ledger
- Replay is purely deterministic: `state_N = fold(applyTick, state_0, ledger[0..N])`
- No floating-point time accumulation (tick count is exact)

I must explicitly acknowledge that my Round 1 proposal for pre-computed deterministic schedules failed to satisfy these requirements. The debate forced me to recognize three fatal flaws:

1. **Interruption semantics are unresolved**: When user input arrives mid-schedule, the ledger representation becomes ambiguous (cancel? merge? pause?). This creates new proof obligations for schedule interruption logic.

2. **The checksum verification surface explodes**: Verifying that a pre-computed schedule is correct requires proving the hash matches across platforms, which depends on floating-point behavior. Fixed timestep has no such verification surface—tick indices are self-verifying.

3. **The epsilon problem is relocated, not solved**: The schedule generation loop still contains `while (v > EPSILON)`, just hidden in a pre-computation phase. This doesn't eliminate non-determinism; it only relocates it from runtime to schedule generation.

Option A avoids all three problems by making every decision explicit and verifiable:

```typescript
// Formal verification is straightforward
Theorem DeterministicReplay:
  ∀ ledger_entries, state_0:
    replay(state_0, ledger_entries)
      = computeState(state_0, ledger_entries)

Proof:
  Tick entries are pure functions of state
  Suspension entries are identity transitions
  Replay is fold of pure functions
  Therefore output is deterministic
```

### The Provenance Tracking Advantage

Expert 004's earlier proposal emphasized "purer causality" by eliminating empty ticks. Option A achieves this through a different mechanism: **by making suspension explicit, we preserve causality without sacrificing efficiency.**

Compare ledger representations:

**Pure fixed timestep (always active):**

```
Tick 1000: [ApplyDamping]
Tick 1001: [ApplyDamping]
Tick 1002: [ApplyDamping]
... (216,000 more empty/damping ticks)
Tick 216,999: []  // Empty tick
```

**Fixed timestep with suspend/resume:**

```
Tick 1000: [ApplyDamping]
Tick 1001: [ApplyDamping]
Tick 1002: [ApplyDamping]
Tick 1003: [Suspend]
// Gap (no ledger entries, no computation)
Tick 1004: [Resume, UserInput]
```

The suspend/resume version has cleaner provenance: the gap is explained by an explicit causal event (suspension), not by implicit absence.

**Verification complexity**:

- Pure fixed timestep: O(wall-clock-time) to iterate through empty ticks
- Suspend/resume: O(active-ticks + state-transitions)

For a 1-hour idle session with 2 minutes of interaction, suspend/resume reduces proof obligations from 216,000 ticks to ~120 ticks plus 2 state transitions.

### Comparison to My Prior Position

In my final statement, I advocated for Option A but noted 95% confidence with some residual uncertainty about implementation details. After reading all other experts' final statements, that confidence has increased to 98%. Here's why:

**Expert 001 resolved the distributed consensus question**: Suspension decisions can be committed through the consensus protocol. All replicas reach the same suspension point through explicit ledger entries, preserving determinism in multi-replica settings.

**Expert 003 settled the numerical stability question definitively**: Variable Δt schemes (including my proposed schedules) accumulate O(max(Δt)) error, while fixed Δt has O(Δt²) error. The physics integration argument is decisive—camera damping must use fixed intervals to converge identically across platforms.

**Expert 005 clarified the architectural separation**: Suspend/resume is not a "hybrid" between fixed and event-driven—it's a single unified temporal model with lifecycle states. The kernel runs at fixed timestep when active, and the suspension/resume layer is execution-lifecycle management, not a separate temporal domain.

---

## Key Factors

### Factor 1: Temporal Coordinates Must Be Explicit

The defining characteristic of deterministic systems is that temporal ordering must be decidable without runtime inspection. Fixed timestep achieves this through tick indices. Event-driven approaches attempt to use event ordering as a proxy for time, but this requires proving the scheduler is deterministic—a higher burden.

With suspend/resume, temporal coordinates (tick numbers) are still explicit and monotonic. The suspension events are observed transitions, not hidden optimization artifacts.

### Factor 2: Interruption Handling is Architecturally Simple

Every other approach requires solving the interruption problem:

- Event-driven needs schedule cancellation logic
- Pre-computed schedules need merge semantics for interrupted continuations
- Storage-layer compression needs decompression during replay

Fixed timestep with suspend/resume requires no interruption logic: each tick is independent. User input just queues a new rule that applies in the next tick. This architectural simplicity translates to lower verification complexity.

### Factor 3: Proof Burden Scales with Events, Not Time

The formal verification cost is not O(wall-clock-duration) but O(events + state-transitions):

- Active ticks: O(event count)
- Suspend/resume boundaries: O(2) per suspension period
- Total: O(events) not O(time)

This is critical for auditability and certification. A system with 2 hours of interactions plus 98 hours of suspension has roughly 120 ledger entries (2 hours × 60 Hz) plus ~4 suspension boundaries, not 432,000 entries.

### Factor 4: Proven Precedent from Operating Systems

Expert 003 cited game engine precedent; my domain adds OS kernel precedent. Every major operating system uses fixed-interval scheduling with suspension/wake mechanisms. This pattern has been battle-tested for 50+ years across billions of systems.

The suspend/resume approach is not novel—it's the proven solution when temporal quantization meets lifecycle management.

### Factor 5: No Unresolved Technical Debt

My proposal for pre-computed schedules left several open questions:

- How do interrupted schedules update the ledger?
- What happens when user input arrives during a scheduled continuation?
- How do checksums account for platform-specific floating-point differences?

Option A leaves no such questions unanswered. Every technical concern raised by other experts has a clear solution.

---

## Persuasive Arguments from Other Experts

### Expert 001's Interruption Analysis Was Decisive

Expert 001's insight that "pre-computed schedules assume closed-world continuations" correctly identified the fatal flaw in my proposal. The demonstration that user input can arrive at any point during a schedule, requiring cancellation or merge logic, was the critical moment where I recognized the approach was adding complexity rather than reducing it.

The rebuttal that "fixed timestep makes each tick independent" is architecturally elegant—interruption is not a special case, just another rule application.

### Expert 003's Numerical Stability Theorem

Expert 003's formal statement that "discretization error is O(Δt²) for constant Δt but O(max(Δt)) for variable Δt" was the technical proof I lacked. This is a mathematical fact from numerical analysis, not an engineering preference. It eliminates all variable-timestep approaches, including my pre-computed schedules.

The observation that I was "reinventing fixed timestep with extra steps" forced intellectual honesty: my schedule-generation loop contained `t += TICK_DELTA`, which is the fixed timestep computation I was trying to avoid.

### Expert 002's Performance Realism

Expert 002 forced confrontation with actual workloads: 216,000 empty ticks per idle hour is unacceptable for battery life and thermal management. But Expert 002 also demonstrated that suspend/resume achieves identical O(events) performance to pure event-driven without the scheduling complexity.

The performance comparison table (3,600 ticks for pure fixed vs. 300 ticks for suspend/resume in a realistic 1-minute session) showed that the efficiency gain is substantial, not marginal.

### Expert 005's Architectural Reframing

Expert 005's separation of "temporal semantics" (how time advances) from "execution lifecycle" (when to compute) was the breakthrough insight. This reframing eliminated the false dichotomy between "correctness" and "efficiency." We don't choose between fixed timestep's determinism and event-driven's efficiency—we choose both.

The observation that "suspend/resume is not a hybrid, it's a unified temporal model with lifecycle states" validated that the approach is architecturally coherent, not a compromise.

---

## Technical Confidence

My confidence in Option A is **98%**. The 2% residual uncertainty concerns:

1. **Distributed consensus for suspend/resume**: The actual implementation of consensus-based suspension decisions may reveal unanticipated complexities. However, this is a distributed systems problem (Expert 001's domain), not a formal verification problem.

2. **Floating-point behavior in epsilon thresholds**: Different platforms might converge at slightly different epsilon thresholds due to rounding differences. This would be detected through cross-platform replay testing and is a deployment concern, not a technical one.

3. **Future scheduling requirements**: If WARP gains features requiring far-future scheduling (e.g., "remind me tomorrow"), the wall-clock integration might introduce non-determinism. However, Expert 002 identified a mitigation: scheduled events can be treated as external inputs (like user clicks) and logged with their scheduled timestamps.

None of these concerns undermine the fundamental correctness of Option A.

---

## Why Not the Alternatives?

### Option B (Pure Event-Driven)

Without fixed Δt, numerical stability cannot be guaranteed. Expert 003's analysis is dispositive. Variable-timestep damping integration causes platform-dependent convergence. This violates the determinism requirement.

If WARP were purely discrete (no continuous behaviors), Option B would be viable. But camera inertia is explicitly mentioned as a core UX feature, making variable Δt unacceptable.

### Option C (Fixed Timestep with Run-Length Encoding)

This achieves determinism but at the cost of:

- 216,000+ empty ticks per idle hour
- Ledger storage requires compression/decompression
- Replay must iterate through empty ticks
- Provenance traces include noise

Option A achieves the same determinism with superior efficiency (zero idle overhead) and cleaner provenance.

### Option D (Event-Driven with Pre-Computed Schedules)

My own proposal. The debate revealed fatal flaws:

1. **Interruption semantics**: No clear answer for when user input arrives mid-schedule
2. **Checksum verification**: Adds new proof surface depending on platform floating-point behavior
3. **Complexity cost**: Same as fixed timestep but with added schedule management

The pre-computed schedule approach was intellectually interesting but technically inferior to simpler alternatives. I'm grateful the debate process forced this recognition.

---

## Conclusion

Option A represents the convergence of five expert perspectives with genuinely conflicting initial positions. What's remarkable is not that we converged, but that the convergence revealed a deeper principle: **in deterministic systems with provenance tracking, temporal quantization is unavoidable—the only question is where to make it explicit.**

Fixed timestep makes time explicit (tick indices). Suspend/resume makes lifecycle explicit (state transitions). Together, they provide:

- **Determinism** (Expert 001's requirement): Temporal coordinates are authoritative and monotonic
- **Efficiency** (Expert 002's requirement): Zero overhead during idle periods
- **Stability** (Expert 003's requirement): Fixed Δt for numerical integration
- **Provenance** (Expert 004's requirement): Explicit state transitions without noise
- **Coherence** (Expert 005's requirement): Unified model with clear architectural boundaries

From a formal methods perspective, this is the architecturally correct solution.

---

**Expert 004**
**Formal Methods, Provenance Tracking, Correctness Proofs**
**Final Confidence: 98%**
**Vote: Option A (Fixed Timestep with Suspend/Resume at 60 Hz)**
