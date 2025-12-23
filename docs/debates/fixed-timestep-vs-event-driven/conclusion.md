# Conclusion: Fixed Timestep vs Event-Driven Ticks in Deterministic WARP Engine

**Debate Date**: 2025-12-22
**Expert Panel**: 5 domain experts (Distributed Systems, Performance Engineering, Game Engine Architecture, Formal Methods, Systems Architecture)
**Debate Structure**: Opening Statements → Round 1 → Round 2 → Final Statements → Voting → Closing Statements
**Total Documents**: 34 files across all phases

---

## Executive Summary

After rigorous multi-round debate involving five domain experts, the panel **unanimously recommends (5-0 vote)**:

### **OPTION A: Fixed Timestep with Suspend/Resume at 60 Hz**

**Confidence**: 95-98% across all experts

This architecture provides:

- **Deterministic temporal semantics** through fixed Δt = 16.67ms when active
- **Performance efficiency** through automatic kernel suspension when idle
- **Numerical stability** for continuous behaviors (camera inertia damping)
- **Formal verification tractability** with explicit temporal coordinates
- **Proven precedent** from 30+ years of game engine and OS kernel evolution

---

## The Question

In a deterministic, provenance-tracked WARP engine with:

- Discrete ticks (atomic rule application batches)
- Continuous behaviors (camera inertia with velocity damping)
- Immutable ledger (source of truth for replay and audit)
- Rendering separation (state evolution independent of frame rate)

**Should ticks be driven by a fixed timestep or event-driven scheduling?**

---

## Debate Evolution

### Starting Positions (Opening Statements)

**Pro Fixed Timestep (2 experts)**:

- **Expert 001** (Distributed Systems): Temporal quantization required for determinism; inertia demands regular sampling
- **Expert 003** (Game Engines): Numerical stability requires constant Δt; industry precedent validates pattern

**Pro Event-Driven (2 experts)**:

- **Expert 002** (Performance): Wasteful computation during idle; O(time) vs O(events) complexity
- **Expert 004** (Formal Methods): State transition purity; provenance tractability; ledger efficiency

**Moderate/Hybrid (1 expert)**:

- **Expert 005** (Architecture): Event-driven with scheduled physics; semantic clarity over clock artifacts

### Critical Turning Points

#### Round 1: Emergence of Synthesis

- **Expert 005** proposed "Fixed Timestep with Suspend/Resume" separating temporal semantics from execution lifecycle
- **Expert 002** acknowledged that event-driven scheduling must still use deterministic timestamps
- **Expert 004** proposed "Pre-Computed Deterministic Schedules" as hybrid approach
- **Expert 001** and **Expert 003** began exploring efficiency optimizations

#### Round 2: Convergence Through Analysis

- **Expert 001** identified fatal interruption semantics flaw in pre-computed schedules
- **Expert 004** conceded pre-computed schedules "reinvent fixed timestep with extra steps"
- **Expert 002** recognized suspend/resume achieves O(events) efficiency without scheduler complexity
- **Expert 003** validated suspend/resume against game engine precedent
- **Expert 005** formalized the architectural insight separating "how time advances" from "when to compute"

**All 5 experts voted NO on extension** → Proceeded to final statements

### Final Vote: UNANIMOUS (5-0)

| Expert | Domain                   | Vote         | Confidence |
| ------ | ------------------------ | ------------ | ---------- |
| 001    | Distributed Systems      | **Option A** | 95%        |
| 002    | Performance Engineering  | **Option A** | 95%        |
| 003    | Game Engine Architecture | **Option A** | 95%        |
| 004    | Formal Methods           | **Option A** | 98%        |
| 005    | Systems Architecture     | **Option A** | Unanimous  |

---

## Why Option A (Fixed Timestep with Suspend/Resume) Won

### Synthesis of All Expert Requirements

The winning architecture satisfies requirements across all five domains:

#### 1. Distributed Systems (Expert 001)

- **Tick indices as temporal coordinates**: Deterministic, consensus-committable integers
- **No scheduler complexity**: Simple state machine (Active/Suspended) instead of event scheduling
- **Trivial replay guarantees**: Iterate ticks 0..N, apply rules, verify checksums
- **Clean interruption semantics**: Each tick is independent; no schedule cancellation logic

#### 2. Performance Engineering (Expert 002)

- **O(events) efficiency during idle**: Zero CPU overhead when suspended
- **No empty tick waste**: 10-minute session with 30 seconds interaction = ~2,000 ticks (not 36,000)
- **Battery and thermal optimization**: Background tabs consume zero CPU
- **Predictable performance**: No scheduler overhead or priority queue management

#### 3. Game Engine Architecture (Expert 003)

- **Numerical stability**: Fixed Δt achieves O(Δt²) discretization error vs O(max(Δt)) for variable timestep
- **Proven precedent**: Unity, Unreal, Source, mobile game engines all use suspend/resume pattern
- **Natural inertia handling**: Damping runs every tick during motion; kernel suspends when converged
- **Rendering separation**: Fixed update loop + variable render loop with interpolation

#### 4. Formal Methods (Expert 004)

- **Explicit temporal coordinates**: Tick count is first-class ledger object, not derived
- **No floating-point accumulation**: Integer arithmetic for time prevents platform divergence
- **Minimal proof surface**: O(events + state_transitions), not O(wall_clock_time)
- **Compositional verification**: Each tick's correctness proof is independent

#### 5. Systems Architecture (Expert 005)

- **Separation of concerns**: Temporal semantics (fixed 60 Hz) decoupled from execution lifecycle (active/suspended)
- **Execution-layer optimization**: Suspend/resume is simpler than storage-layer compression or scheduling-layer event management
- **Clear mental model**: Kernel runs at 60 Hz when active, sleeps when idle
- **Manageable complexity**: Well-understood OS pattern (sleep/wake) vs novel scheduler design

---

## Technical Foundation: Key Arguments

### Argument 1: Temporal Quantization is Unavoidable (Expert 001)

**Theorem**: Any deterministic system with temporal reasoning must quantize time into discrete coordinates.

**Proof**: Event-driven systems claiming to avoid fixed timestep must still:

- Assign deterministic timestamps to scheduled events
- Log those timestamps in the ledger for replay
- Ensure all replicas derive identical timestamps

This is isomorphic to tick counting. "Event-driven" relocates temporal quantization to the scheduler but doesn't eliminate it.

**Implication**: Fixed timestep makes temporal quantization explicit and simple (tick indices). Event-driven hides it in scheduler complexity.

### Argument 2: Numerical Stability Requires Constant Δt (Expert 003)

**Theorem**: Camera inertia damping with variable timestep accumulates O(max(Δt)) discretization error; fixed timestep achieves O(Δt²).

**Mathematical Basis**:

```
Exact solution: v(t) = v₀ · e^(-λt)

Fixed Δt approximation:
v[n+1] = v[n] · (1 - λΔt)  // Error: O(Δt²)

Variable Δt approximation:
v[n+1] = v[n] · (1 - λΔt[n])  // Error: O(max(Δt))
```

Different tick sequences (even with identical total elapsed time) produce different final states with variable Δt, violating determinism across platforms and replay scenarios.

**Implication**: Pure event-driven architectures cannot guarantee deterministic continuous behavior across platforms.

### Argument 3: Interruption Semantics Reveal Architectural Flaws (Expert 001, Expert 003)

**Problem**: Pre-computed schedules (Option D) pre-calculate tick sequences (e.g., 23-tick damping after pan release) with checksums for verification.

**Fatal Flaw**: What happens when user input arrives during tick 12 of 23?

Options:

1. **Cancel schedule**: Violates checksum, reintroduces non-determinism
2. **Queue input**: Unacceptable UX delay (input ignored for 183ms)
3. **Run in parallel**: Two concurrent temporal domains, hybrid complexity

**Solution**: Fixed timestep with suspend/resume handles interruption naturally. Each tick processes all pending inputs. No schedule lifecycle management needed.

### Argument 4: Suspend/Resume Achieves O(events) Without Scheduler Complexity (Expert 002, Expert 005)

**Performance Comparison** (10-minute session, 30 seconds of user interaction):

| Architecture   | Active Ticks | Idle Ticks | Total  | CPU Wake Events             |
| -------------- | ------------ | ---------- | ------ | --------------------------- |
| Fixed (pure)   | 1,800        | 34,200     | 36,000 | 36,000                      |
| Event-driven   | ~1,800       | 0          | ~1,800 | ~1,800 + scheduler overhead |
| Suspend/Resume | 1,800        | 0          | 1,800  | 2 (suspend + resume)        |

**Analysis**: Suspend/resume achieves event-driven efficiency without:

- Priority queue management
- Scheduled wakeup tracking
- Deterministic timestamp derivation
- Schedule interruption handling

**Implementation**: Simple state machine with dirty-flag pattern for O(1) suspension detection.

### Argument 5: Explicit Temporal Coordinates Enable Formal Verification (Expert 004)

**Formal Requirements for Provenance-Tracked Systems**:

1. Temporal coordinates must be **explicit** (not derived from ledger)
2. Temporal coordinates must be **stable** across platforms (no floating-point accumulation)
3. Temporal coordinates must be **monotonic** (verifiable ordering)
4. Temporal coordinates must be **deterministic** (same coordinate for same logical time across all replicas)

**Comparison**:

| Architecture    | Temporal Coordinate         | Explicit? | Stable? | Monotonic? | Deterministic?                 |
| --------------- | --------------------------- | --------- | ------- | ---------- | ------------------------------ |
| Fixed + Suspend | Tick index (uint64)         | ✓         | ✓       | ✓          | ✓                              |
| Event-driven    | Derived timestamp (float64) | ✗         | ✗       | ✓          | Requires proof                 |
| Pre-computed    | Schedule index + checksum   | ✓         | ✓       | ✓          | Requires interruption handling |

**Implication**: Only fixed timestep tick indices satisfy all four requirements without additional proof burden.

---

## Rejected Alternatives and Their Fatal Flaws

### Option B: Pure Event-Driven with Deterministic Scheduling

**Why Considered**: Efficiency (O(events) not O(time)), clean causality, minimal ledger

**Fatal Flaw**: Variable Δt between ticks causes numerical instability in camera inertia damping (Expert 003's O(max(Δt)) error accumulation theorem)

**Additional Issues**:

- Scheduler complexity (priority queue, wakeup tracking, deterministic timestamps)
- Interruption handling still required
- No precedent in production systems with continuous behaviors

**Verdict**: Technically feasible but architecturally inferior to suspend/resume

---

### Option C: Fixed Timestep with Run-Length Encoding

**Why Considered**: Simplest mental model, no lifecycle complexity

**Why Rejected**: Solves storage problem but not CPU/battery/replay-latency problems

**Analysis**:

- Storage: Run-length encoding reduces ledger size (solved)
- CPU: Kernel still wakes 60 times/second during idle (unsolved)
- Battery: Background tabs drain power continuously (unsolved)
- Replay: Must process all ticks, including 99% empty ones (unsolved)

**Verdict**: Superseded by suspend/resume which solves all four problems

---

### Option D: Event-Driven with Pre-Computed Schedules

**Why Considered**: Hybrid benefits (event-driven efficiency + fixed-Δt stability)

**Fatal Flaw**: Interruption semantics (Expert 001's critique)

When user input arrives mid-schedule:

- Canceling violates checksum determinism
- Queuing violates UX responsiveness
- Parallel execution creates two temporal domains

**Additional Issues** (Expert 004's analysis):

- Checksum verification adds O(schedule_count) proof surface
- Epsilon problem relocated, not solved (when to stop scheduling?)
- No production precedent (theory-only architecture)

**Verdict**: Reinvents fixed timestep with extra complexity

---

## Implementation Specification

### Core Architecture

```typescript
enum KernelState {
  Active = 0, // Ticking at 60 Hz
  Suspended = 1 // Zero CPU overhead
}

interface KernelLifecycle {
  state: KernelState;
  tickCount: uint64; // Monotonic tick index
  lastActivity: uint64; // Tick when last rule was applied
  epsilon: number; // Convergence threshold for continuous behaviors
}

function tickOrSuspend(kernel: KernelLifecycle): void {
  if (kernel.state === KernelState.Suspended) {
    // Kernel is sleeping, waiting for external input
    return;
  }

  // Active: execute tick
  const rules = selectApplicableRules();
  const receipt = applyRules(rules, kernel.tickCount);
  appendToLedger(receipt);
  kernel.tickCount++;

  // Check suspension condition
  if (shouldSuspend(kernel)) {
    kernel.state = KernelState.Suspended;
    appendToLedger({ type: 'suspend', tick: kernel.tickCount });
  }
}

function shouldSuspend(kernel: KernelLifecycle): boolean {
  // Suspend when:
  // 1. No user inputs pending
  // 2. All continuous behaviors converged below epsilon
  // 3. No scheduled future rules

  const noInputs = inputQueue.isEmpty();
  const converged = cameraVelocity.magnitude() < kernel.epsilon;
  const noScheduled = scheduledRules.isEmpty();

  return noInputs && converged && noScheduled;
}

function onExternalInput(input: UserInput, kernel: KernelLifecycle): void {
  if (kernel.state === KernelState.Suspended) {
    kernel.state = KernelState.Active;
    appendToLedger({ type: 'resume', tick: kernel.tickCount });
  }
  enqueueInput(input);
}
```

### Ledger Format

```typescript
interface TickReceipt {
  tick: uint64; // Temporal coordinate (never skips, always monotonic)
  rules: RuleApplication[]; // Applied rules (can be empty during active state)
  checksum: Hash; // State hash after application
}

interface SuspendReceipt {
  type: 'suspend';
  tick: uint64; // Tick when suspension occurred
}

interface ResumeReceipt {
  type: 'resume';
  tick: uint64; // Tick when kernel resumed (same as previous suspend tick)
  trigger: InputEvent; // What caused resume
}

type LedgerEntry = TickReceipt | SuspendReceipt | ResumeReceipt;
```

### Replay Semantics

```typescript
function replay(ledger: LedgerEntry[]): State {
  let state = initialState;
  let kernelActive = true;

  for (const entry of ledger) {
    if (entry.type === 'suspend') {
      kernelActive = false;
      // Tick count freezes during suspension
      continue;
    }

    if (entry.type === 'resume') {
      kernelActive = true;
      continue;
    }

    // Regular tick receipt
    if (kernelActive) {
      state = applyRules(entry.rules, state);
      assert(hash(state) === entry.checksum);
    }
  }

  return state;
}
```

### Key Implementation Details

1. **Tick Count Semantics**: Represents state transitions, not wall-clock time. During suspension, tick count does not advance.

2. **Wall-Clock Metadata**: Store wall-clock duration as metadata for debugging, but never use for determinism:

   ```typescript
   interface TickMetadata {
     wallClockMs: number; // For debugging only
     platformInfo: string; // For cross-platform analysis
   }
   ```

3. **Epsilon Calibration**: Convergence threshold for suspension detection:

   ```typescript
   const EPSILON = 1e-6; // Camera velocity magnitude threshold
   const IDLE_TICKS = 3; // Require 3 consecutive converged ticks before suspending
   ```

4. **Distributed Consensus**: In multi-replica settings, suspension is a consensus decision:
   ```typescript
   // All replicas must agree on suspension tick
   // Use distributed state machine replication (Raft, Paxos)
   const suspendProposal = { tick: kernel.tickCount, reason: 'converged' };
   const consensusResult = await propose(suspendProposal);
   if (consensusResult.committed) {
     kernel.state = KernelState.Suspended;
   }
   ```

---

## Remaining Concerns and Mitigations

### Concern 1: Epsilon Threshold Calibration (5% uncertainty)

**Issue**: How to choose epsilon for "camera velocity below threshold"?

- Too high: Suspends prematurely, visible motion artifacts
- Too low: Never suspends, wastes CPU

**Mitigation**:

- Start with conservative threshold (1e-6 for normalized velocity)
- Require N consecutive converged ticks (e.g., 3) before suspending
- Make epsilon configurable per-platform
- Add telemetry to measure actual convergence patterns

**Confidence**: 95% (well-understood calibration problem from game engines)

---

### Concern 2: Distributed Suspend/Resume Consensus Latency (5% uncertainty)

**Issue**: In multi-user collaborative WARP sessions, suspension requires distributed consensus. Consensus latency might delay suspension decision.

**Mitigation**:

- Suspension is optimization, not correctness requirement (can defer if consensus slow)
- Use fast consensus protocol (Raft with batching)
- Suspend decision is low-priority (non-blocking user input)
- Alternative: Each replica suspends independently, resumes on local input

**Confidence**: 90% (requires distributed systems expertise and testing)

---

### Concern 3: Scheduled Future Rules Interaction (10% uncertainty)

**Issue**: What happens to wall-clock-scheduled rules (e.g., "in 5 seconds, trigger notification")?

**Scenario**: User schedules rule for tick+300 (5 seconds), then kernel suspends for 10 minutes.

**Options**:

1. **Relative ticks**: Store "300 ticks from now", resume adds delay
2. **Absolute wall-clock**: Store "wallClock + 5s", suspension breaks determinism
3. **Hybrid**: Store both, use relative for determinism

**Recommended**: Option 3 (hybrid) with relative tick offset as source of truth

**Confidence**: 85% (requires careful design of scheduling API)

---

### Concern 4: Cross-Platform Floating-Point Variance (2% uncertainty)

**Issue**: Camera inertia uses floating-point damping factor. Different platforms (x86, ARM, WASM) might have slight variance in exponential decay calculation.

**Mitigation**:

- Use fixed-point arithmetic for physics integration
- Require IEEE 754 compliance across all platforms
- Add epsilon tolerance in state checksum verification (not tick-by-tick exact match)
- Formal proof that variance is bounded and doesn't accumulate

**Confidence**: 98% (well-understood problem with known solutions)

---

## Implementation Roadmap

### Phase 1: Fixed Timestep Foundation (Weeks 1-2)

- Implement 60 Hz tick loop
- Camera inertia with fixed Δt integration
- Ledger with tick receipts and checksums
- Replay verification
- **Goal**: Deterministic replay across platforms

### Phase 2: Suspend/Resume Lifecycle (Weeks 3-4)

- Kernel state machine (Active/Suspended)
- Suspension detection with epsilon threshold
- Resume on external input
- Ledger suspend/resume events
- **Goal**: Zero CPU overhead during idle

### Phase 3: Distributed Consensus (Weeks 5-6)

- Multi-replica suspension consensus (if applicable)
- Suspension latency optimization
- Resume synchronization across replicas
- **Goal**: Collaborative sessions with suspend/resume

### Phase 4: Optimization and Validation (Weeks 7-8)

- Epsilon threshold calibration with telemetry
- Cross-platform floating-point verification
- Performance profiling (idle CPU, battery drain, replay latency)
- Formal verification of determinism guarantees
- **Goal**: Production-ready with provable correctness

---

## Conclusion: The Architectural Insight

The debate revealed that **"fixed timestep vs event-driven" is a false dichotomy**.

The real architectural question is: **Where should we optimize away idle overhead?**

Three layers:

1. **Storage layer**: Compress empty ticks after execution (run-length encoding)
2. **Scheduling layer**: Pre-compute tick sequences to avoid empty execution (pre-computed schedules)
3. **Execution layer**: Suspend kernel when idle (suspend/resume)

**Suspend/resume optimizes at the execution layer**, which:

- Requires no scheduler complexity (simpler than layer 2)
- Provides better efficiency than storage compression (layer 1)
- Uses proven OS kernel patterns (sleep/wake)
- Makes suspension an explicit ledger event (preserves provenance)

This architectural insight—**separating temporal semantics from execution lifecycle**—unlocked the synthesis that satisfies all five expert domains simultaneously.

---

## Final Recommendation

**ADOPT: Fixed Timestep with Suspend/Resume at 60 Hz**

**Confidence: 95-98%** (unanimous expert consensus)

**Rationale**:

- Achieves determinism through fixed Δt (distributed systems requirement)
- Achieves efficiency through suspension (performance engineering requirement)
- Achieves numerical stability through constant timestep (game engine requirement)
- Achieves formal verification through explicit temporal coordinates (formal methods requirement)
- Achieves architectural coherence through separation of concerns (systems architecture requirement)

**Implementation**: Follow 4-phase roadmap with emphasis on cross-platform validation and distributed consensus (if multi-user).

**Validation**: All five domain experts independently converged on this architecture through rigorous technical debate. The unanimity of the decision, combined with 95-98% confidence levels, indicates the solution is architecturally sound across all relevant dimensions.

---

**Moderator**: Claude (Structured Debate Framework)
**Date**: 2025-12-22
**Status**: COMPLETE
