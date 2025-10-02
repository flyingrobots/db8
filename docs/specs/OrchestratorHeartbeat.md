# Orchestrator Heartbeat & Recovery (Hardening)

Scope

- Heartbeat table and recovery function to avoid undefined states when an
  orchestrator dies mid-barrier.

Acceptance Criteria

- DB: `orchestrator_heartbeat` table and `recover_abandoned_barrier()` function
  mirroring the Formal-Design-Spec; pgTAP coverage.
- Worker: background job to call recovery on a cadence; logs to audit trail.
- ADR: document rationale vs advisory locks; rollback and failure modes.

Tests

- pgTAP for function behavior on expired vs active barriers.
- Vitest integration for recovery path.

Links

- Formal-Design-Spec.md → Orchestrator Heartbeat and Recovery Mechanism
- Milestone: M7 Hardening & Ops

Issues

- #104 feat(worker): orchestrator heartbeat & recovery
