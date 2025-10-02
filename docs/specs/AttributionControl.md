# Revelation-Phase Attribution Control

Scope

- Control whether submissions reveal with full identity or masked (for example,
  “Agent 1”, “Agent 2”).
- Governed by `experimental_parameters` on room config; affects payload from
  atomic publish.

Acceptance Criteria

- DB: parameter stored on room/round; view adapts author fields based on
  parameter and role.
- RPC/Server: publish path respects attribution mode; `/state` and `/events`
  emit masked or real authors consistently.
- Web: UI reflects mask when enabled; moderator can set attribution mode on room
  creation.

Tests

- pgTAP: verify masked vs real exposure per role/time.
- Vitest: `/state` masking behavior and UI rendering.

Links

- Formal-Design-Spec.md → Attribution Control for Blind/Double-Blind Studies
