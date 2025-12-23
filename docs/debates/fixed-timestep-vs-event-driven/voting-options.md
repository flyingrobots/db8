# Voting Options - Synthesized from Debate

Based on all expert statements across opening, Round 1, Round 2, and final statements, the following options have emerged:

## Option A: Fixed Timestep with Suspend/Resume (60 Hz)

**Description**: The kernel runs at fixed 60 Hz timestep when active, with explicit suspend/resume lifecycle management. When no rules are pending and all continuous behaviors have converged below epsilon thresholds, the kernel suspends. User input or scheduled events resume execution.

**Key Features**:

- Fixed Δt = 16.67ms during active periods
- Automatic suspension when idle (zero CPU overhead)
- Explicit suspend/resume events in ledger
- Tick count represents state transitions (not wall-clock time)
- Wall-clock duration stored as metadata

**Advocates**: Expert 001 (distributed systems), Expert 003 (game engines), Expert 005 (architecture)
**Converted**: Expert 002 (performance - initially opposed), Expert 004 (formal methods - initially opposed)

---

## Option B: Pure Event-Driven with Deterministic Scheduling

**Description**: Ticks occur only when rules are enqueued. Continuous behaviors (like inertia) use self-scheduling patterns where each tick schedules the next tick with explicit timestamps in the ledger.

**Key Features**:

- Ticks fire on-demand (O(events) not O(time))
- Scheduling timestamps must be deterministically derived and logged
- Inertia implemented as scheduled continuation rules
- Zero idle overhead by design

**Advocates**: Initially Expert 002 (performance), Expert 004 (formal methods)
**Concerns Raised**: Numerical stability (Expert 003), scheduler complexity (Expert 001), interruption semantics (Expert 005)

---

## Option C: Fixed Timestep with Run-Length Encoding

**Description**: Pure fixed timestep (60 Hz always running) with storage-layer compression. Empty ticks are run-length encoded in the ledger to reduce storage cost while maintaining the logical model of continuous ticking.

**Key Features**:

- Tick stream never stops (even when idle)
- Compression at storage layer only
- Simplest mental model (time always advances)
- Highest CPU overhead

**Advocates**: Initially Expert 001 (before suspend/resume emerged)
**Superseded By**: Option A (achieves same determinism with better efficiency)

---

## Option D: Event-Driven with Pre-Computed Schedules

**Description**: Hybrid approach where continuous behaviors pre-compute their entire tick sequence upfront, storing it with checksums. Event-driven tick firing with fixed-Δt numerical integration within schedules.

**Key Features**:

- Pre-computed damping schedules (e.g., 23-tick sequence for pan release)
- Checksum verification for determinism
- Event-driven efficiency when idle
- Fixed-Δt stability within scheduled sequences

**Advocates**: Expert 004 (formal methods, Round 1)
**Critical Flaws Identified**: Interruption semantics (Expert 001), schedule management overhead (Expert 002), reinvents fixed timestep complexity (Expert 003)

---

## Recommended Vote Format

Each expert should:

1. **Vote for ONE primary option** (A, B, C, or D)
2. **Provide detailed rationale** explaining:
   - Why this option best serves the system's requirements
   - How it addresses concerns from other experts
   - What trade-offs are acceptable
3. **List key factors** that influenced the decision
4. **Reference specific expert arguments** that were persuasive or concerning
