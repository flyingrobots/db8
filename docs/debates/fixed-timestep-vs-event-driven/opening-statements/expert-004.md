# Opening Statement: Expert 004

## Domain: Formal Methods, Provenance Tracking, Correctness Proofs

### Position: OPPOSE Fixed Timestep

I oppose the resolution that ticks should be driven by a fixed timestep. From a formal verification perspective, event-driven ticks provide stronger determinism guarantees and more tractable correctness proofs.

### Core Argument: State Transition Purity

A deterministic system's correctness rests on proving that state transitions are pure functions of inputs. The fundamental question is: **what constitutes an input?**

**Fixed Timestep Conflates Time with Input:**

- Time becomes an implicit input injected at regular intervals
- Creates phantom state transitions when no logical input exists
- Bloats the ledger with redundant "nothing happened" receipts
- Makes replay verification check thousands of no-op ticks

**Event-Driven Preserves Input Causality:**

- Each tick corresponds to a meaningful state change
- Ledger contains only causal transitions: `State[n] = f(State[n-1], Input[n])`
- Replay verification becomes: verify each receipt against its input
- Provenance chain shows actual causal history, not time-padded artifacts

### The Inertia Red Herring

The camera inertia concern is a category error. Inertia is not continuous - it's a scheduled future input:

```
Input[t0]: PanStart(velocity=v0)
  → Schedules: Input[t1], Input[t2], ..., Input[tn] (damped velocities)
  → Each scheduled input appears as a rule proposal
  → Each triggers a tick when it arrives

Ledger records:
  Receipt[0]: Applied PanStart, scheduled 60 follow-up ticks
  Receipt[1]: Applied PanContinue(v=0.98*v0)
  Receipt[2]: Applied PanContinue(v=0.98²*v0)
  ...
```

This is **more deterministic** than fixed timestep because:

- The damping schedule is computed once and committed to the ledger
- No floating-point accumulation across ticks
- Replay doesn't depend on "when" ticks occurred, only their sequence
- Easy to prove: `final_position = initial + Σ(scheduled_velocities)`

### Formal Properties

**Determinism Proof Complexity:**

Fixed Timestep:

```
∀ ledger L, ∀ replay R:
  Let t_start = L[0].timestamp
  Let t_now = current_time()
  Verify: len(R) = ⌈(t_now - t_start) / Δt⌉
  Then: ∀i ∈ [0, len(R)): R[i] = recompute(L, i*Δt)
```

**Problem**: Replay must synthesize timestamps. Proof requires reasoning about clock synchronization.

Event-Driven:

```
∀ ledger L, ∀ replay R:
  Verify: len(R) = len(L)
  Then: ∀i ∈ [0, len(L)): R[i] = recompute(L[i].inputs)
```

**Advantage**: No time reasoning. Pure function verification.

**Provenance Tractability:**

When debugging "why did X happen?", event-driven gives:

```
Receipt[42]: Applied ExpandNode(id=5)
  Triggered by: UserClick(x=100, y=200)
  Previous state: Node[5].collapsed = true
  New state: Node[5].collapsed = false
```

Fixed timestep gives:

```
Receipt[9842]: No inputs (tick 9842/60000)
Receipt[9843]: Applied ExpandNode(id=5)
  Triggered by: UserClick(x=100, y=200) at t=164.05s
  Previous state: Node[5].collapsed = true
  New state: Node[5].collapsed = false
Receipt[9844]: No inputs (tick 9844/60000)
Receipt[9845]: No inputs (tick 9845/60000)
...
```

The noise obscures causality. Proving "X caused Y" requires filtering no-ops.

### Ledger Efficiency is Not Optional

Provenance tracking means **every tick lives forever**. At 60 Hz:

- 1 minute = 3,600 receipts (mostly empty)
- 1 hour = 216,000 receipts
- 1 day = 5,184,000 receipts

Event-driven for same session:

- 1 minute = ~50 receipts (actual interactions)
- 1 hour = ~500 receipts
- 1 day = ~2,000 receipts

This isn't just storage - it's **proof verification cost**. Every audit must process the entire ledger. Fixed timestep makes verification O(time), event-driven makes it O(events).

### Consistency Argument is Backwards

The claim that fixed timestep provides "consistent user experience" ignores that **rendering is decoupled**. The render loop can run at 60 Hz regardless:

```
// Event-driven kernel
kernel.tick() called only when kernel.hasPendingInputs()

// Fixed-rate rendering
function renderLoop() {
  requestAnimationFrame(renderLoop)
  const state = kernel.getCurrentState()  // Always available
  render(state)  // Smooth 60fps
}
```

Users see smooth animation. Kernel only wakes when causally necessary.

### Proposed Voting Options

1. **Pure Event-Driven**: Tick only when inputs/scheduled-rules exist
   - Pro: Minimal ledger, pure causality, simplest proofs
   - Con: Requires scheduling mechanism for inertia

2. **Fixed Timestep**: Tick every Δt regardless of inputs
   - Pro: Simpler mental model for continuous behavior
   - Con: Ledger bloat, weaker provenance, time-dependent replay

3. **Hybrid**: Fixed timestep when any continuous behavior active, event-driven otherwise
   - Pro: Reduces no-op ticks during idle periods
   - Con: Worst of both - complex mode switching, still time-dependent

4. **Quantized Event**: Round event timestamps to Δt boundaries, tick on quantized events
   - Pro: Bounded tick rate without no-ops
   - Con: Introduces time discretization without solving core issues

### Recommendation

**Option 1: Pure Event-Driven** is the only choice consistent with rigorous provenance tracking. The system's purpose is to maintain an auditable causal chain. Fixed timestep injects phantom causality that dilutes this guarantee.

The inertia problem is solvable with self-scheduling rules - a pattern that generalizes to all continuous behavior without polluting the ledger with time-based no-ops.

---

**Expert 004**
_Formal Methods & Correctness Proofs_
