# Opening Statement: Expert 005

## Position: Moderate Support for Event-Driven, with Caveats

From a systems architecture perspective, this debate centers on managing complexity versus achieving guarantees. Both approaches can deliver determinism, but they distribute complexity differently across the system.

## Architectural Analysis

### The Fundamental Trade-off

This is not a pure technical question—it's an architectural question about where we want complexity to live:

1. **Fixed Timestep**: Complexity lives in synchronization between the simulation clock and external inputs
2. **Event-Driven**: Complexity lives in scheduling continuous behaviors and managing sparse state transitions

### Design Coherence Concerns

**Fixed Timestep Advantages:**

- Single authoritative clock simplifies reasoning about causality
- Uniform tick intervals create predictable performance characteristics
- Well-understood pattern with decades of game engine precedent
- Replay is trivial: deterministic function of tick count and input log

**Event-Driven Advantages:**

- Better semantic alignment: ticks represent actual state changes, not clock artifacts
- Ledger directly reflects provenance (no "nothing happened" ticks)
- Natural fit for discrete rule systems
- Scales better for sparse interaction patterns

### The Inertia Problem

Both camps must address camera inertia, but in opposite ways:

- **Fixed timestep**: Inertia is "free"—physics runs every tick automatically
- **Event-driven**: Inertia requires explicit scheduling—physics must request its own future ticks

This is where architectural philosophy matters. Which feels more honest to the system's nature?

### Long-Term Maintainability

**Complexity Metrics:**

Fixed timestep introduces:

- Input buffering and interpolation logic
- Frame rate independence concerns
- Potential tick/frame desynchronization bugs
- "Empty" ticks consuming ledger space

Event-driven introduces:

- Scheduling infrastructure for continuous behaviors
- Rule priority and ordering complexity
- Potential for unbounded tick sequences
- More sophisticated replay logic

**Maintenance Burden:**

Fixed timestep is simpler to understand initially but can accumulate edge cases around input timing. Event-driven requires more upfront design but results in clearer semantics: "a tick is a change."

### Ledger Philosophy

This is subtle but important: what is the ledger for?

If the ledger is a **proof of computation**, event-driven is more honest—it records only meaningful state transitions.

If the ledger is a **replayable timeline**, fixed timestep is clearer—it's a function evaluation at regular intervals.

I lean toward the former. Provenance tracking should reflect causality, not clock ticks.

## Recommendation

**Lean event-driven, but with guardrails:**

1. Accept the scheduling complexity—it's manageable with clear abstractions
2. Design explicit "continuation" rules for physics (inertia schedules next tick)
3. Implement tick budget limits to prevent runaway sequences
4. Provide debugging tools to visualize tick sequences and rule firings

**Critical architectural requirements regardless of choice:**

- Decouple rendering from state evolution (both approaches support this)
- Make time explicit in the state (don't rely on implicit tick counts)
- Design for testability (mock time sources, deterministic scheduling)
- Build introspection tools early (ledger visualization, replay debugging)

## Proposed Voting Options

Rather than binary, I suggest voting on a spectrum:

1. **Pure Fixed Timestep**: Kernel advances on constant Δt, all behaviors passive
2. **Fixed Timestep with Lazy Ticks**: Skip ticks when provably no changes occur
3. **Event-Driven with Scheduled Physics**: Ticks on-demand, continuous behaviors self-schedule
4. **Hybrid**: Fixed timestep for physics layer, event-driven for discrete rules
5. **Pure Event-Driven**: All ticks triggered by rules, no background clock

My preference: **Option 3** (Event-Driven with Scheduled Physics)

This maintains semantic clarity while handling inertia explicitly. The scheduling overhead is worth the architectural honesty.

## Key Questions for Other Experts

1. Can we prove determinism bounds for event-driven scheduling? (Formal methods)
2. What is the actual performance delta in realistic scenarios? (Performance)
3. How do other engines handle this trade-off? (Game engine)
4. What are the distributed replay implications? (Distributed systems)

---

**Expert 005**
Systems Architecture
