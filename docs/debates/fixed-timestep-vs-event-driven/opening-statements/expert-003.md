# Opening Statement: Expert 003

**Domain Expertise**: Game engine architecture, fixed timestep patterns, simulation loops, physics integration, inertia handling

## Position: Strong Support for Fixed Timestep

As Expert 003, I approach this question from decades of hard-won lessons in game engine architecture. The fixed timestep pattern exists because we learned—painfully—that event-driven physics creates subtle, insidious bugs that destroy determinism.

### The Inertia Problem is Decisive

Camera inertia is mentioned almost casually in the problem statement, but it is the smoking gun. Let me be explicit about what happens under each model:

**Event-Driven with Inertia:**

```
t=0.000: User presses key → tick 1 → velocity = v0
t=0.016: Still holding → tick 2 → velocity = v1
t=0.032: Releases key → tick 3 → velocity starts damping
t=0.048: No input, but v > 0 → must tick → velocity = v2
t=0.064: Still coasting → must tick → velocity = v3
...continues until velocity ≈ 0
```

You now have a continuous system masquerading as event-driven. The engine must schedule its own ticks based on "is anything moving?" This is fixed timestep with extra steps and worse guarantees.

**Fixed Timestep:**

```
Every 16.67ms: tick, apply damping, integrate position
Input events are sampled and consumed
Clean separation of concerns
```

### Determinism Requires Uniform Integration

Physics integration (including damping functions) is only deterministic when Δt is constant:

```typescript
// Damping with variable Δt
velocity *= Math.pow(dampingFactor, Δt); // Different Δt → different convergence
position += velocity * Δt; // Accumulates floating-point drift
```

With variable Δt (event-driven), you get:

- Different numerical paths to the same "logical" state
- Platform-dependent floating-point accumulation
- Replay breaks when tick timing differs even slightly

### Ledger Size is a Red Herring

The concern about "empty ticks inflating the ledger" assumes ticks with no rule applications are wasteful. But consider:

1. **Inertia means continuous state change**: Position updates ARE rule applications
2. **Time itself is state**: Deterministic replay requires knowing when nothing happened
3. **Compression is trivial**: Run-length encode idle periods in storage
4. **The ledger must support temporal queries**: "What was the world state at t=5.3s?" requires tick alignment

### System Complexity: Hidden Costs of Event-Driven

Event-driven looks simpler on paper but requires:

- **Wakeup scheduling**: "Next tick should happen at t + Δt when velocity > ε"
- **Convergence detection**: "When is inertia 'done enough' to stop ticking?"
- **Edge case handling**: What if input arrives during scheduled wakeup?
- **Replay synchronization**: Ledger must record both events AND scheduled ticks

Fixed timestep complexity is front-loaded and well-understood:

- Single loop: `while (accumulator >= Δt) { tick(); accumulator -= Δt; }`
- Input buffering: Queue events between ticks
- Render interpolation: `render(state, accumulator / Δt)`

### The Rendering Trap

"Rendering is separate from state evolution" is stated but must be enforced. Fixed timestep makes this trivial:

```typescript
// Fixed timestep
let accumulator = 0;
function gameLoop(realDt: number) {
  accumulator += realDt;
  while (accumulator >= TICK_DT) {
    tick(TICK_DT); // Deterministic
    accumulator -= TICK_DT;
  }
  render(interpolate(accumulator / TICK_DT)); // Smooth
}
```

Event-driven makes rendering fraught:

- When do you render if no tick happened?
- How do you interpolate between variable-Δt ticks?
- What if render rate exceeds tick rate (no new state)?

### Provenance Tracking Benefits

Fixed timestep provides superior provenance:

```json
{
  "tick": 1337,
  "wallTime": 22.283333, // tick * Δt (derivable)
  "rules": ["camera.damp", "node.expand"],
  "checksum": "0xdeadbeef"
}
```

Every tick number maps to exact simulation time. Debugging becomes:

- "Show me tick 1337" (not "show me the tick near 22.28s")
- Binary search for divergence in replay
- Consistent across all replays, platforms, speeds

### User-Visible Consistency

Fixed timestep guarantees that:

1. **Physics feels identical across framerates**: 30fps and 144fps both integrate at 60Hz
2. **Playback speed is trivial**: 2x speed = process 2 ticks per render frame
3. **Input timing is fair**: All inputs within a tick window get processed together

## Proposed Voting Options

**Option A**: Fixed timestep at 60Hz (16.67ms)

- Pros: Industry standard, well-tested, deterministic
- Cons: May over-sample idle periods

**Option B**: Fixed timestep at 120Hz (8.33ms)

- Pros: Better input responsiveness, smoother inertia
- Cons: 2x ledger growth, more CPU

**Option C**: Event-driven with scheduled wakeups

- Pros: Minimal ticks when idle
- Cons: Complex, determinism risks, replay fragility

**Option D**: Hybrid (fixed when active, sleep when fully idle)

- Pros: Efficient idle, deterministic when needed
- Cons: Mode-switching complexity, must detect "fully idle"

## Recommendation

**Vote for Option A or B** (fixed timestep). The choice between 60Hz and 120Hz is a performance trade-off, but both preserve determinism and simplify the system.

Event-driven (Option C) is a trap: you will reinvent fixed timestep badly while chasing inertia bugs. Hybrid (Option D) might work but adds state machine complexity for marginal gains.

### Implementation Note

If ledger size is genuinely a concern (billions of ticks), implement at the storage layer:

```typescript
// Write side: always record every tick
ledger.append({ tick, rules, checksum });

// Read/storage side: compress idle runs
compress([
  { tick: 1000, rules: [...] },
  { tick: 1001, rules: [] },    // \
  { tick: 1002, rules: [] },    //  } → { ticks: 1001-2099, idle: true }
  // ... 97 more idle ticks      // /
  { tick: 2100, rules: [...] }
]);
```

This preserves the logical model (every tick recorded) while optimizing storage. Decompression for replay is trivial.

---

**Expert 003**
_Game Engine Architecture Specialist_
