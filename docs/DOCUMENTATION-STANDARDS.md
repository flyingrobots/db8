---
lastUpdated: 2026-08-16
tags: [standard]
---

# Documentation Standards

**Status:** Current project policy for new and substantially changed documentation.
**Applies to:** User, CLI, API, database, operations, and contributor documentation in `db8`.
**Normative terms:** **MUST**, **SHOULD**, and **MAY** indicate requirement strength.

This does not require a mass rewrite. Apply it when creating documentation,
changing behaviour, or touching a page enough that leaving it below this bar
would create new debt.

Its companion is [the testing standards](TESTING-STANDARDS.md). Documentation
says what the system does; tests are the evidence that it does. Where the two
disagree, the tests are right and the page is a defect.

## 1. Purpose

Documentation is part of the product contract. A db8 page should help a specific
reader do one of these jobs:

- learn the system through a guided first success;
- complete a real task in their own environment;
- look up exact facts while working;
- understand a concept, boundary, or design choice;
- troubleshoot an observable failure;
- change the implementation safely and verify the result.

A page **MUST** have one primary job. Do not force a README, spec, or guide to
behave as tutorial, reference manual, roadmap, and architecture guide at once.

## 2. Corpus map

db8 keeps its durable truth in a small set of known places.

| Location                                                              | Job                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `README.md`                                                           | Public front door: what db8 is, how to try it, install paths, project status, links to deeper docs. |
| `docs/README.md`                                                      | Documentation spine and routing index. Every new durable page **MUST** be linked here.              |
| `docs/specs/<Topic>.md`                                               | Living specification for a durable product concept, describing behaviour on `main`.                 |
| `docs/Architecture.md`                                                | Current system shape: services, storage, request paths.                                             |
| `docs/Teardown.md`                                                    | End-to-end explanation of how the system actually executes, for a reader with no prior knowledge.   |
| `docs/GettingStarted.md`, `docs/LocalDB.md`, `docs/CLI-Quickstart.md` | Guided first success.                                                                               |
| `docs/CLI.md`, `docs/Provenance.md`, `docs/Verification.md`           | Reference for a public surface.                                                                     |
| `docs/Ops.md`                                                         | Operator runbook: cross-origin config, dead-letter queue, failover, key rotation.                   |
| `docs/TESTING-STANDARDS.md`, `docs/DOCUMENTATION-STANDARDS.md`        | Standards. Normative, rule-cited.                                                                   |
| `docs/DesignGuide.md`, `docs/Formal-Design-Spec.md`                   | Design discipline and the formal model.                                                             |
| `docs/adr/`                                                           | Architecture Decision Records. One decision each, immutable once accepted.                          |
| `docs/feature-proposals/`                                             | Proposal-era records. They explain **why**; they do not pose as current truth.                      |
| `docs/tasks/backlog.md`                                               | Staging only. See [AGENTS.md](../AGENTS.md) for the one-place rule.                                 |
| `CHANGELOG.md`                                                        | Release-visible historical ledger.                                                                  |
| `CONTRIBUTING.md`                                                     | Prerequisites, install, running, tests, linters, commit rules.                                      |
| `AGENTS.md`                                                           | How an agent works in this repository.                                                              |

Add tutorials, how-to guides, reference pages, or troubleshooting pages when a
reader need is not well served by a spec. Recommended as the corpus grows:

```text
docs/
  how-to/
  reference/
  troubleshooting/
```

Do not create empty placeholder directories. Add a page when it has a real
reader job.

**Every page in `docs/` describes `main`.** There is no session-log or debrief
archive, and one **MUST NOT** be reintroduced: git history already holds it, and
a narrative log decays into stale "current state" claims that outrank the code
in a reader's mind. When a page stops being true, fix it or delete it — git
keeps the old version, and a deleted page cannot mislead anyone.

The one exception is `docs/feature-proposals/`, which records proposal-era
reasoning. Those pages explain **why** a change was accepted or rejected; they
**MUST NOT** be read as current behaviour, and each **MUST** say so.

## 3. Page types

### 3.1 Specification

A spec describes current behaviour for a durable concept — claim terms, voting,
attribution control, scoring, research tools.

A spec **MUST**:

- describe only behaviour that exists on `main`;
- state public contracts, invariants, and supported usage;
- distinguish current behaviour from known gaps;
- carry `tags: [spec]` and the exact milestone string in frontmatter;
- avoid roadmap promises except as explicitly labelled limitations or links.

It **MUST NOT** become the only user-facing guide for a workflow that needs
step-by-step help.

Operational procedures — releasing, key rotation, failover — belong in
`docs/Ops.md`, not in a spec.

### 3.2 Evidence

db8 does not keep a separate test-plan file per topic. Evidence lives in the
suite, and [the testing standards](TESTING-STANDARDS.md) govern its quality.

A spec that states an invariant **SHOULD** name the test that pins it, by path.
A stated invariant with no test is a **known gap** and **MUST** be labelled as
one rather than written as though it holds. Planned work is not evidence.

### 3.3 Tutorial

A tutorial is a guided learning path for a newcomer needing a controlled first
success — "run a debate round locally", "sign and verify your first submission".

A tutorial **MUST** state prerequisites and starting state, use a known-good
path, give actions in tested order, show expected intermediate and final
results, and end with what the reader learned and where to go next.

### 3.4 How-to guide

A how-to guide helps a competent reader complete a real task — "enrol an SSH key
for provenance", "point the web app at a remote API".

A how-to guide **MUST** be titled as a goal starting with a verb, state the
expected result, identify blocking prerequisites, give the shortest safe route,
include exact commands and settings, explain how to verify success, and link to
reference or explanation rather than reproducing it.

### 3.5 Reference

Reference pages support exact lookup. db8's public surfaces:

- `db8` CLI commands, options, and **exit statuses**;
- HTTP endpoints (`/rpc/*`, `/state`, `/events`, `/journal`, `/verify/*`) with
  request and response shapes;
- SQL functions in `db/rpc.sql` — signature, idempotency key, and phase gates;
- environment variables, their defaults, and their effect;
- error identifiers (`invalid_claim_term`, `claim_path_not_found`,
  `quota_exceeded`, `author_not_configured`, and the rest);
- the claim-term node vocabulary and path grammar.

Reference **MUST** state exact names, syntax, fields, defaults, constraints,
output, errors, and examples. Where the surface is machine-readable, the
reference **SHOULD** be generated or coverage-checked.

An undocumented environment variable that changes behaviour is a defect, not an
omission. `CANON_MODE` alone has produced two shipped bugs.

### 3.6 Explanation

Explanation develops a mental model: why claim terms are an AST rather than
prose, why denial must not distribute over conjunction, why persistence sits
behind a port, why the journal is a hash chain.

Explanation **SHOULD** describe mechanisms, relationships, trade-offs,
alternatives, and limits. It **MUST NOT** become an unstructured code tour.

### 3.7 Decision record

An ADR records one decision, the context that forced it, and what it costs. It is
written when the decision is made and **never edited afterwards** except to change
its status; a reversal is a new ADR that supersedes the old one.

An ADR **MUST** state the context without presupposing the outcome, name the
decision in the active voice, list consequences **including the bad ones**, and
give the alternatives genuinely considered with the specific reason each lost. An
ADR listing only benefits is marketing and will not be trusted the next time.

Write one when a choice is hard to reverse, or cheap to reverse and easy to
forget: a boundary moves, a rule starts or stops being enforced somewhere, a
defect is recorded rather than fixed, or a serious alternative was rejected. Do
**not** write one for a routine fix or a refactor that moves no boundary.

See [docs/adr/README.md](adr/README.md) and its [template](adr/template.md).

### 3.8 Troubleshooting

Troubleshooting starts with an observable symptom:

- the room page renders with no submission form;
- the browser console reports no `Access-Control-Allow-Origin` header;
- `db8 submit` exits non-zero with a digest mismatch;
- a verdict is rejected as `claim_path_not_found`;
- the round never advances past `submit`.

A troubleshooting page **MUST** list discriminating checks first, map signals to
likely causes, give concrete recovery actions, and show how to verify the fix.

### 3.9 Contributor guide

Contributor docs explain how to change the implementation safely. They
**SHOULD** explain the system model before listing files. Source links support
an explanation; they do not replace one.

## 4. Maintenance loop

For a meaningful behaviour change:

1. Record design discussion only if the change needs it.
2. Add the smallest deterministic executable evidence that fails for the missing
   behaviour, per [the testing standards](TESTING-STANDARDS.md).
3. Implement the behaviour.
4. Update the living spec, reference, or guide **after** the behaviour exists.
5. Update `README.md`, `docs/README.md`, and `CHANGELOG.md` when the public
   surface, documentation routing, or release posture changes.

Small fixes may scale this down, but they still need a clear claim, evidence
when behaviour changes, and honest current truth.

## 5. Examples and executable truth

Examples are part of the contract.

User-facing examples **MUST**:

- be syntactically valid;
- use supported behaviour;
- include enough context to run or interpret them;
- use least-privileged and safe defaults;
- identify destructive or privileged actions clearly;
- show an observable result when one exists.

Examples **SHOULD** be extracted from tested files or executed in CI where
practical. A JSON payload in a spec **SHOULD** use the exact field names the Zod
schema defines; a payload that would be rejected by `server/schemas.js` is
wrong, however illustrative it looks.

### 5.1 Runnable, illustrative, and abridged

A **runnable** example uses supported behaviour and includes required context.

An **illustrative** example may omit setup, but **MUST** be labelled illustrative
and **MUST NOT** be presented as directly runnable.

An **abridged** example may shorten large input or output, but **MUST** identify
the omitted material and preserve the behaviour relevant to the explanation.
Claim terms nest, so abridging one is common — mark the elision.

### 5.2 Code blocks and terminal examples

Every fenced block **SHOULD** declare its language:

- `bash` for copyable shell commands;
- `json`, `sql`, `js`, `jsx`, `yaml` for structured input;
- `text` for expected output;
- `console` only for a transcript that deliberately includes prompts.

Do not include `$` prompts in a block intended for copy and paste. Present
commands and output separately.

Run:

```bash
node bin/db8.js draft validate --path draft.json --nonce fixednonce123 --json
```

Expected output:

```text
{"ok":true,"canonical_sha256":"<64 hex characters>"}
```

When output is nondeterministic, say which parts vary — digests, UUIDs, and
timestamps almost always do. Label output as exact, representative, or abridged
when the distinction matters. **Never fabricate output** to make an example look
complete.

### 5.3 Placeholders

Use clearly fictional, context-safe values.

| Context                | Preferred placeholder                                 |
| ---------------------- | ----------------------------------------------------- |
| Copyable shell command | `draft.json`, `$DB8_ROOM_ID`                          |
| UUID                   | `00000000-0000-0000-0000-000000000001`                |
| Digest                 | `<64 hex characters>`                                 |
| Hostname               | `example.com`                                         |
| Citation URL           | `https://example.com/study`                           |
| Secret or credential   | an explicitly fake value such as `test_token_example` |

Do not use `<your-file>` inside a copyable shell command; angle brackets have
shell meaning.

### 5.4 Dangerous commands

For destructive, privileged, or irreversible actions — dropping the test
database, rotating signing keys, running the `final_votes` deduplication
upgrade:

1. Place the warning **before** the command.
2. State the exact consequence and scope.
3. Provide a dry-run or safer alternative when one exists.
4. State required permissions.
5. Include rollback guidance when applicable.
6. Explain how to verify the result.

## 6. Visuals and accessibility

db8 has a visual surface — the room page, the claim-term editor, the journal
viewer, and CLI output. Documentation for those **SHOULD** include enough visual
material for a reader to recognize the interface and its important states.

Diagrams are first-class here. Prefer **Mermaid** in fenced ` ```mermaid `
blocks: it renders on GitHub, diffs as text, and cannot go stale silently the
way an exported image does.

Every nontrivial visual **MUST**:

- answer a stated or obvious reader question;
- have meaningful labels or adjacent explanation;
- include alt text or a concise textual equivalent;
- distinguish conceptual simplification from exact implementation;
- omit or redact secrets, personal data, and production identifiers.

Informative images **MUST** have alt text. Decorative images **SHOULD** have
empty alt text. Complex diagrams **SHOULD** have adjacent explanatory prose
rather than a long alt attribute.

Visuals **MUST NOT** rely on color, position, or shape alone to communicate
essential meaning, and **MUST NOT** be the only place where essential
instructions, code, or error details appear.

## 7. Writing, style, and terminology

Write like a competent teammate: direct, precise, approachable.

- Use `you` for actions the reader performs.
- Use `db8`, `the server`, `the watcher`, or the component name for actions the
  system performs.
- Use imperative verbs for procedures, present tense for current behaviour.
- Prefer active voice when it clarifies who is responsible; use passive when the
  actor is unknown or irrelevant.
- Avoid hype, vague reassurance, unnecessary apology, and exclamation.
- Avoid `we` unless referring to an explicit project decision.

Prefer:

> Run `db8 submit --path draft.json`. The command exits with status `2` when the
> server's digest does not match the client's.

Avoid:

> You may encounter an issue if something goes wrong with your submission.

### 7.1 Sentences, paragraphs, and lists

- Put the result, decision, warning, or essential condition first.
- Give each sentence one main job.
- Use numbered lists for ordered procedures, bullets for parallel items, prose
  when causality or trade-offs matter.

Sentence length, paragraph length, passive voice, and bullet count are editorial
signals. They **MUST NOT** become merge gates.

### 7.2 Markdown and typography

- Bold for exact visible UI labels, and sparingly for genuine warnings.
- Inline code for commands, options, filenames, paths, configuration keys, field
  names, literal values, error identifiers, and code symbols.
- Exact casing for commands, options, fields, and errors.
- Descriptive link text. Never `here`, `this link`, or a bare filename as the
  entire label.
- Tables for genuinely two-dimensional lookup, not for narrative or procedures.

### 7.3 Terminology

Use one canonical term per concept and define unfamiliar terms at first use.
db8's shared vocabulary:

| Term               | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| **room**           | A debate. Owns configuration and participants.                             |
| **round**          | One turn of a room, with a `phase` and deadlines.                          |
| **phase**          | `submit`, `published`, `final`. The round state machine.                   |
| **participant**    | A member of a room, with role `debater`, `host`, or `judge`.               |
| **submission**     | One debater's content plus structured claims for a round.                  |
| **claim term**     | The AST of what a debater asserted.                                        |
| **claim path**     | An address for one node inside a claim term (`$`, `$.body`, `$.parts[1]`). |
| **verdict**        | A judge's ruling on a claim at a claim path.                               |
| **journal**        | The signed, hash-chained per-round record.                                 |
| **canonical form** | The byte-exact serialization that gets hashed and signed.                  |
| **canon mode**     | `jcs` (RFC 8785) or `sorted`.                                              |
| **watcher**        | The process that advances rounds when deadlines pass.                      |

Use exact names: `db8` is the CLI binary; `server/rpc.js` is the API entry point;
`server/watcher.js` is the watcher; `verify_submit` and `submission_upsert` are
SQL functions.

### 7.4 Inclusive and accessible language

Use literal, neutral language describing the technical condition directly.
Prefer _unavailable_, _hidden_, _degraded_, _unresponsive_, _excluded_, or
_blocked_ when those are the actual conditions. Use gender-neutral language when
a person's gender is irrelevant, and avoid idioms that make instructions harder
to translate.

### 7.5 Notes, cautions, and warnings

- **Note** — useful context that does not affect safety or correctness.
- **Important** — required to complete the task correctly.
- **Caution** — may cause an undesirable or costly result.
- **Warning** — may cause data loss, a security problem, or an irreversible
  change.

Do not use a warning merely to make ordinary text look important.

## 8. Checks and enforcement

Documentation quality needs both deterministic checks and human judgement.

Run the documentation gate for documentation changes:

```bash
npm run lint:md
npm run lint:spelling
npx prettier --check .
```

Link checking is available but hits the network, so it stays advisory:

```bash
npm run lint:links
```

CI **SHOULD** block only on facts it can determine reliably. What exists today:

- malformed Markdown — `markdownlint` (`npm run lint:md`);
- spelling and unknown terms — `cspell` (`npm run lint:spelling`), with new
  vocabulary appended to `cspell.json` near a topical neighbor, never re-sorted;
- formatting — `prettier --check`.

Known gaps, aspirational until an implementation lands:

- **internal link and anchor resolution** — no offline checker exists; the
  current `lint:links` is network-dependent and therefore advisory;
- **citations to files, symbols, or tests that do not exist** — nothing verifies
  that a page citing `server/claims/paths.js#pathsOf` still resolves;
- **frontmatter conformance** — the `lastUpdated` / `tags` / milestone policy in
  [the design guide](DesignGuide.md) is unenforced;
- **undocumented public surface** — no coverage check ties CLI commands, HTTP
  endpoints, environment variables, or error identifiers to reference pages;
- **executable examples** — no doctest harness; examples are verified by review.

The following **SHOULD** remain advisory: page length, sentence length, passive
voice, jargon density, bullet count, tone, overuse of bold, table complexity,
external-link health, and screenshot age. These are useful editorial signals and
poor merge gates.

## 9. Review checklist

Before calling a documentation change done:

- The page has one primary reader job.
- The page describes current `main` behaviour. If it no longer can, it is fixed
  or deleted — not left standing with a caveat.
- Planned work lives in an issue, backlog entry, or labelled limitation — not in
  the present tense.
- Examples use supported behaviour, exact field names, and show observable
  results where possible.
- Public commands, options, environment variables, statuses, and error
  identifiers have or link to reference coverage.
- Stated invariants name their test, or are labelled as gaps.
- New durable pages are linked from `docs/README.md`.
- A decision that moved a boundary, changed what is enforced, or recorded a
  defect instead of fixing it has an ADR, linked from the code or spec it governs.
- Release-visible changes update `CHANGELOG.md`.
- Frontmatter carries `lastUpdated`; the first body line is a single H1.
- Markdown, spelling, and formatting checks pass.

The objective is not a uniform library. It is a corpus where readers, reviewers,
tests, and agents can find the right authoritative page at the moment they need
it.
