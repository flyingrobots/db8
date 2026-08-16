---
lastUpdated: 2026-08-16
tags: [spec]
milestone: 'M3: Verification'
---

# Verification

A judge or host records a **verdict** — `true`, `false`, `unclear`, or
`needs_work` — against a submission, a claim within it, or **one node of that
claim's term**. A read-only summary aggregates them for the UI and the CLI.

The third of those is what makes this more than a rating widget. See
[Claim Terms](specs/ClaimTerms.md) for the addressing model; the short version is
that _"the study says remote work reduces productivity"_ has an attribution at
`$` and the proposition it attributes at `$.body`, and a judge can rule them
differently. Merging those two findings destroys the only distinction that
mattered.

## Storage

`verification_verdicts` (`db/schema.sql:292-306`), with a `claim_path` column
recording which node the verdict rules on. `NULL` means the claim as a whole.

Idempotency is the unique index `ux_verification_verdicts_unique_path`
(`db/schema.sql:331-336`), over six expressions:

```text
round_id, reporter_id, submission_id,
coalesce(claim_id, ''), coalesce(claim_path, ''),
coalesce(nullif(client_nonce, ''), '')
```

Two consequences worth knowing before relying on this:

- **`claim_path` is part of the key**, so a verdict on `$` and a verdict on
  `$.body` are two rows rather than one overwriting the other.
- **`client_nonce` is also part of the key**, so the same reporter resubmitting
  under a fresh nonce creates a **second counted row**. That is deliberate — it
  is how a judge revises a ruling — but it means one reporter can file unbounded
  verdicts on one submission, and `verify_summary` counts each. This is the wrong
  invariant for any per-checker tally and is the open question in
  [#87](https://github.com/flyingrobots/db8/issues/87).

## RPCs

```text
verify_submit(round_id, reporter_id, submission_id, claim_id, verdict,
              rationale, client_nonce, p_claim_path DEFAULT NULL) → uuid
verify_summary(round_id) → TABLE (submission_id, claim_id, claim_path,
              true_count, false_count, unclear_count, needs_work_count, total)
```

`verify_submit` takes **eight** arguments. The pre-`claim_path` seven-argument
overload was dropped explicitly (`db/rpc.sql:663`): `CREATE OR REPLACE` does not
replace across a changed argument list, and because the new parameter has a
default, a seven-argument call fits both signatures and Postgres refuses it as
not unique.

It is `SECURITY DEFINER` and enforces, in order: the verdict enum, that the
submission belongs to the round, that the round is `published` or `final`
(`round_not_verifiable`), that the reporter is a room participant
(`reporter_not_participant`), and that their role is `judge` or `host`
(`reporter_role_denied`).

`verify_summary` groups by `(submission_id, claim_id, claim_path)`.

## Path resolution happens above the database

A path that parses is not a path that exists. `VerificationService` resolves
`claim_path` against the stored term and rejects `claim_path_not_found`
(`server/services/VerificationService.js:29-42`); `verify_submit` does **not**
re-check it.

That is deliberate: `server/claims/paths.js` owns the grammar, and a plpgsql
reimplementation would be a second copy free to drift. The trade is that a client
reaching the SQL function directly is not stopped.

Paths are also normalized at the schema edge — `$.parts[01]` and `$.parts[1]`
both store as `$.parts[1]`, because the stored string is row identity and the two
spellings would otherwise split one node into two half-counted findings
(`server/schemas.js:155-161`).

## Persistence

Verdict persistence sits behind the `VerdictStore` port, with Postgres and
in-memory adapters selected **by configuration, never by failure** — see
[ADR-0001](adr/0001-persistence-chosen-by-configuration.md). A configured
database that errors returns `503 database_unavailable`; it does not silently
answer from memory.

One contract suite runs against both adapters
(`server/test/verdict.store.contract.test.js`), because they had already drifted
twice.

**A divergence the port does not cover:** the judge/host role gate lives only in
`verify_submit`, so in memory mode any `reporter_id` can file a verdict.

## Endpoints

```text
POST /rpc/verify.submit    → { ok, id }
GET  /verify/summary?round_id=…  → { ok, rows: [...] }
```

## CLI

```bash
db8 verify submit --round <uuid> --submission <uuid> [--claim <id>] \
  --verdict <true|false|unclear|needs_work> [--rationale <text>] [--nonce <id>]

db8 verify summary --round <uuid>
```

The CLI prints `claim_path` (or `(whole)`); the web room page currently does
not, so two findings differing only by path render identically there
([#101](https://github.com/flyingrobots/db8/issues/101) area).

## Known gaps

- **Row level security does not take effect.** The policies at `db/rls.sql:140-161`
  are correct and are bypassed — the API connects as the table owner, no table
  sets `FORCE ROW LEVEL SECURITY`, and nothing sets `db8.participant_id`. See
  [#208](https://github.com/flyingrobots/db8/issues/208). Read visibility is
  currently whatever the query asks for.
- **No quorum or confidence logic exists** — no thresholds, no close rule, no
  `confidence` column. [#87](https://github.com/flyingrobots/db8/issues/87),
  [#89](https://github.com/flyingrobots/db8/issues/89).
- **The projection layer is unwired.** `checkableClaims` is specified as the only
  sanctioned way to turn a term into checkable propositions, and nothing calls it.
  [#212](https://github.com/flyingrobots/db8/issues/212).
