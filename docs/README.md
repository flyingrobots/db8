---
lastUpdated: 2026-08-16
---

# Documentation Map

Every durable page in db8 is listed here. If a page is not linked from this
index, it is not findable — add it when you add the page.

New to db8? Read [the README](../README.md) for what the system is, then
[the Teardown](Teardown.md) for how it actually executes.

## Learn

- [Teardown](Teardown.md) — end-to-end explanation from process entry point to
  durable row, for a reader with no prior knowledge. Start here for the whole
  picture.
- [Getting Started](GettingStarted.md) — install, run the API and the web app,
  configuration.
- [Local Database](LocalDB.md) — Postgres via Docker, schema, RLS, pgTAP.
- [CLI Quickstart](CLI-Quickstart.md) — the shortest path to a signed document.

## Reference

- [CLI](CLI.md) — every `db8` command, its options, and the exit-code taxonomy.
- [Provenance](Provenance.md) — canonicalization, enrolment, verification, and
  enforcement (SSH and Ed25519), with CLI examples.
- [Provenance Explorer](ProvenanceExplorer.md) — the journal-inspection UI.
- [Verification](Verification.md) — the verdict flow and its aggregates.
- A sample submission document for testing signing and verification lives at
  `examples/provenance-document-sample.json`.

## Specifications

Living specs describing behaviour on `main`.

- [Claim Terms](specs/ClaimTerms.md) — the structured claim AST, non-factive
  projection, and path addressing for verdicts.
- [Attribution Control](specs/AttributionControl.md) — who a submission is
  attributed to, and when that is revealed.
- [Voting](specs/Voting.md) — the voting model and final-vote tallying.
- [Scoring and Reputation](specs/ScoringAndReputation.md) — how verdicts and
  votes become scores.
- [Research Tools](specs/ResearchTools.md) — the research surface available
  during a round.
- [Orchestrator Heartbeat](specs/OrchestratorHeartbeat.md) — liveness signalling
  for the round orchestrator.

## Operate

- [Ops](Ops.md) — cross-origin access, the dead-letter queue, orchestrator
  failover, and signing-key rotation.

## Design

- [Architecture](Architecture.md) — services, storage, request paths.
- [Design Guide](DesignGuide.md) — design discipline, including the frontmatter
  policy every Markdown file here follows.
- [Formal Design Spec](Formal-Design-Spec.md) — the formal model.
- [Features](Features.md) · [User Stories](UserStories.md)
- [Future Work](FutureWork.md) — research directions, explicitly not a roadmap.

## Standards

Normative. Rules carry stable IDs; cite them in commits and review.

- [Testing Standards](TESTING-STANDARDS.md) — sections A–K. Governs any change
  that adds, modifies, or deletes a test, or that fixes a defect.
- [Documentation Standards](DOCUMENTATION-STANDARDS.md) — page types, the corpus
  map, examples as contract, and what CI may gate on.

## Process

- [AGENTS.md](../AGENTS.md) — how an agent works in this repository.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — prerequisites, install, tests, linters,
  commit rules.
- [Feature proposals](feature-proposals/README.md) — how a change gets accepted.
  These record proposal-era reasoning and are **not** current behaviour.
- [Backlog](tasks/backlog.md) — staging only. A task lives here or in an open
  issue, never both.

## A note on history

There is no session-log or debrief archive in `docs/`. Git history is the record.
Every page here describes `main`; when a page stops being true it is fixed or
deleted, because a stale page outranks the code in a reader's mind.
