---
lastUpdated: 2025-10-03
---

# Backlog

Use this file to capture well-formed tasks before promoting them to GitHub
issues. Each entry follows a lightweight template compatible with our
Project/labels workflow, so you can lift/paste into `gh issue create`.

## Template

Title: <short imperative>
Type: type/feat|type/chore|type/fix|type/security|type/docs
Area: area/server|area/db|area/web|area/cli|area/worker|area/ci
Priority: priority/p0|p1|p2|p3
Milestone: M1|M2|...
Status: Todo|In Progress|Done
Summary:

- Why it matters in one or two bullets

Acceptance Criteria:

- [ ] concrete, testable outcome 1
- [ ] concrete, testable outcome 2

Notes/Links:

- references (commits/PRs/docs)

---

## room.create docs and examples parity

Type: type/docs
Area: area/server
Priority: priority/p3
Milestone: M1
Status: Todo
Summary:

- Ensure docs/CLI and examples align with current
  `room_create(topic,cfg,client_nonce)` signature.

Acceptance Criteria:

- [ ] CLI quickstart uses client_nonce consistently
- [ ] Architecture.md shows current parameters and idempotency behavior

Notes/Links:

- db/rpc.sql, server/test/rpc.room_create.test.js
- Promoted to Issue #113

## RLS coverage: server reads via views only

Type: type/security
Area: area/server
Priority: priority/p1
Milestone: M1
Status: Todo
Summary:

- Guarantee all server read paths go through security_barrier views under RLS

Acceptance Criteria:

- [ ] grep shows no raw table SELECTs in server code (reads only via views)
- [ ] pgTAP covers allow/deny for submit vs published

Notes/Links:

- db/rls.sql, submissions_with_flags_view
- Promoted to Issue #112

## pgTAP expansion for RLS, triggers, nonces

Type: type/chore
Area: area/ci
Priority: priority/p1
Milestone: M1
Status: Todo
Summary:

- Broaden pgTAP to cover RLS policies and NOTIFY triggers; document CI gate

Acceptance Criteria:

- [ ] New pgTAP asserts RLS deny/allow and trigger NOTIFY
- [ ] CI workflow flag documented; job name matches rulesets

Notes/Links:

- .github/workflows/ci.yml (#82/#72)
- Duplicate of existing Issue #82 — remove from backlog when you start work.

## Audit trail wiring (submission, vote, watcher)

Type: type/feat
Area: area/server
Priority: priority/p2
Milestone: M2
Status: Todo
Summary:

- Persist admin audit entries for key actions using admin_audit_log_write()

Acceptance Criteria:

- [ ] /rpc/submission.create writes audit row
- [ ] /rpc/vote.continue writes audit row
- [ ] watcher flips write audit row

Notes/Links:

- db/rpc.sql (admin_audit_log_write)
- Promoted to Issue #114

## RFC 8785 JCS canonicalization

Type: type/feat
Area: area/server
Priority: priority/p2
Milestone: M2
Status: Todo
Summary:

- Adopt JCS for stable canonical hashing across runtimes

Acceptance Criteria:

- [ ] Identical payloads hash equal under Node 20; test vectors included

Notes/Links:

- docs/Architecture.md, server/utils.js
- Existing Issue #67 — remove from backlog when you start work.
