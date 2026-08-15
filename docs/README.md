---
lastUpdated: 2026-08-11
---

# Documentation Overview

- Provenance example: a sample submission document lives at `docs/examples/provenance-document-sample.json`. Use it as a reference shape when testing signing/verification flows.
- See `docs/Provenance.md` for JCS canonicalization, enrollment, verification, and enforcement details (SSH and Ed25519), plus CLI examples.

## Specifications

- [Attribution Control](specs/AttributionControl.md) — who a submission is attributed to, and when that is revealed.
- [Claim Terms](specs/ClaimTerms.md) — the structured claim AST, non-factive projection, and path addressing for verdicts.
- [Orchestrator Heartbeat](specs/OrchestratorHeartbeat.md) — liveness signalling for the round orchestrator.
- [Research Tools](specs/ResearchTools.md) — the research tool surface available during a round.
- [Scoring and Reputation](specs/ScoringAndReputation.md) — how verdicts and votes become scores.
- [Voting](specs/Voting.md) — the voting model and final-vote tallying.

## Guides

- [Getting Started](GettingStarted.md) — install, run the API and the web app, configuration.
- [Local Database](LocalDB.md) — Postgres via Docker, schema, RLS, pgTAP.
- [CLI](CLI.md) and [CLI Quickstart](CLI-Quickstart.md) — the `db8` command.
- [Ops](Ops.md) — cross-origin access, dead-letter queue, orchestrator failover, signing-key rotation.
- [Provenance](Provenance.md) and [Provenance Explorer](ProvenanceExplorer.md) — canonicalization, signing, verification.
- [Verification](Verification.md) — the verdict flow.

## Design

- [Architecture](Architecture.md) — services, storage, request paths.
- [Design Guide](DesignGuide.md) · [Formal Design Spec](Formal-Design-Spec.md)
- [Features](Features.md) · [User Stories](UserStories.md)

## Process

- [Feature proposals](feature-proposals/README.md) — how a change gets accepted.
