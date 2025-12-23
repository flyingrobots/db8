# Debate Premise: Fixed Timestep vs Event-Driven Ticks in a Deterministic WARP Engine

## Background (shared by both sides)

We are building a deterministic, provenance-tracked computation engine that powers a visual WARP graph. The system operates on discrete ticks: each tick selects a batch of rewrite rules, applies them, and appends a receipt to an immutable ledger. This ledger is the source of truth for replay and audit.

## Key Facts About the System

- **Determinism is required.** Given the same initial state and the same sequence of inputs, the engine must produce an identical worldline (sequence of tick receipts and states).
- **Tick = epoch.** A tick is one atomic update where a batch of rules is selected and applied.
- **Inputs (user actions)** are injected as rule proposals (e.g., pan, zoom, expand node, toggle attachments).
- **The camera has inertia.** Motion can continue briefly after a key is released (velocity damping).
- **Rendering is separate.** The renderer draws the current state every frame, but should not influence state evolution.
- **Replay is core.** The system must support replays and provenance inspection based solely on the ledger and inputs.

## The Open Question: How Should the Engine Advance Ticks?

### Two Options

1. **Fixed Timestep:**
   The kernel advances on a constant Δt (e.g., 1/60) regardless of frame rate or input. Rendering runs independently; the simulation advances in steady increments.

2. **Event-Driven Ticks:**
   The kernel advances only when there are inputs or pending rule proposals. If no rules are applicable, no ticks occur. Any continuous behavior (like inertia) must schedule its own ticks.

## Debate Resolution

**"In a deterministic, provenance-tracked WARP engine, ticks should be driven by a fixed timestep rather than event-driven scheduling."**

## Debate Instructions

- **Affirmative (Pro Fixed Timestep):** Argue that fixed Δt yields stronger determinism, simpler replay, and more consistent behavior.
- **Negative (Pro Event-Driven):** Argue that event-driven ticks are truer to provenance, more efficient, and more aligned with the discrete nature of rule application.

## Evaluation Criteria

Both sides should consider:

- Determinism guarantees
- Replay fidelity
- Correctness of inertia behavior
- Ledger size and efficiency
- System complexity
- User-visible consistency
