---
lastUpdated: 2026-08-16
---

# ADR-0005: Re-scope stale issues in place rather than closing and refiling

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** James Ross

## Context

34 issues were open. 26 of them sat in milestones M3–M7, were 318–325 days old,
and were all written as `type/feat` "build X" tasks. M5 and M6 had **zero** closed
issues while their features were demonstrably present in the schema.

Verifying all 26 against the code produced an uncomfortable distribution:

| Verdict                      | Count      |
| ---------------------------- | ---------- |
| Done                         | 1          |
| **Partial**                  | **12**     |
| Not started                  | 8          |
| Done, under a different name | 4 (closed) |

The dominant verdict was **partial** — the feature shipped and a specific half
did not, with nobody recording which half. So the tracker was wrong in both
directions: "close them all, the work shipped" would have been as wrong as
leaving them open.

The mechanism was renaming. #86 asked for `fact_check_verdicts` with `checker_id`,
`notes`, and a ±1 `verdict_classification`. It shipped as `verification_verdicts`
with `reporter_id`, `rationale`, and a four-valued enum — plus `claim_path`, the
current design's centerpiece, which the issue never anticipated. Anyone grepping
for the issue's table name would conclude the milestone was untouched.

A contributing cause worth naming: **no commit in the entire history references
any of these issue numbers**, so shipped work never auto-closed anything.

## Decision

For the 12 partial issues: **edit the title and body in place** to describe only
the remaining work, prepend a dated triage block stating what shipped and under
what name, and preserve the original text verbatim in a collapsed
`<details>` block.

The issue number, its history, its milestone, and any external references to it
all survive.

Applied alongside two other treatments: 4 verified-done issues closed with a note
recording the renames, and 10 accurately-described issues left untouched with a
triage comment carrying the evidence.

## Consequences

**Better.** An issue's title now describes work that actually remains, so the
tracker is scannable again. Issue numbers stay stable, which matters because
`README.md`, specs, and other issues link to them. The rename tables are captured
where someone hits them — inside the issue whose vocabulary is wrong.

**Worse.** The original ask is no longer the first thing you read. Anyone
reviewing "what did we originally commit to" has to expand a `<details>` block or
read the edit history. For issues that are contracts with someone else, that
would be unacceptable; these are internal planning artifacts, which is why it is
tolerable here.

**Now load-bearing.** The preserved original text. If a future bulk edit drops
the `<details>` block, the provenance is gone — GitHub's edit history is the only
remaining copy, and it is not greppable.

**Must stay true.** That this is a one-off reconciliation, not a habit. Re-scoping
issues routinely would make the tracker's history unreliable. The real fix is
upstream: reference issue numbers in commits so work closes its own issues.

**A structural consequence, deliberately accepted.** Some re-scoped issues now
carry a _different kind_ than their label says — #94 became a bug fix while
labelled `type/feat`, and #97 the same. Labels were left alone rather than
rewritten, to keep the milestone histograms comparable to what they were before.
That inconsistency is a known cost, not an oversight.

## Alternatives considered

**Close the 12 and file 12 fresh issues.** The main alternative, and genuinely
defensible: it preserves the original text unedited and gives each new issue a
clean body with no archaeology. Rejected because it breaks every inbound link and
inflates the closed count with issues that were not actually completed — which
would recreate, in a new form, the same "the tracker says done, the code says
otherwise" problem being fixed.

**Comment only, change nothing.** Rejected: the misleading titles are the
problem. A comment 20 lines down does not help someone scanning a milestone.

**Close everything and rebuild the backlog from the code.** Rejected as
throwing away 300 days of intent. Several of these issues describe work that is
still wanted and still unbuilt.

## References

- Issues #7, #11, #12, #87, #93, #94, #97, #98, #101, #102, #14, #32 — re-scoped
- Issues #86, #96, #99, #15 — closed with rename notes
- `AGENTS.md` — issue and backlog discipline, including the one-place rule
- ADR-0003 — the same instinct applied to documentation, resolved differently:
  docs get deleted, issues get re-scoped. Docs have git; an issue number is a
  public identifier other things point at.
