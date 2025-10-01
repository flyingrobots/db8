#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install GitHub CLI or set GH_TOKEN for API usage." >&2
  exit 1
fi

repo=${1:-}
if [[ -z "${repo}" ]]; then
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner || true)
fi
if [[ -z "${repo}" ]]; then
  echo "Usage: scripts/sync-issues.sh [owner/repo]" >&2
  exit 1
fi

echo "Creating issues in $repo..."

create_issue() {
  local title=$1 body=$2 milestone=$3 labels=$4
  gh issue create \
    --repo "$repo" \
    --title "$title" \
    --body "$body" \
    --milestone "$milestone" \
    $(for l in ${labels//,/ }; do echo --label "$l"; done)
}

# 1) SSE canonical ADR
create_issue \
  "ADR: SSE (DB LISTEN/NOTIFY) as canonical realtime path" \
  "Declare SSE canonical; update docs (Architecture.md, GettingStarted.md). Supabase Realtime optional mirror." \
  "M1" \
  "area/server,type/design,priority/P0"

# 2) Authoritative watcher loop
create_issue \
  "feat(worker): authoritative watcher invokes round flips" \
  "Implement loop calling round_publish_due/open_next; add DB-backed tests; ensure /events emits phase on flip." \
  "M1" \
  "area/worker,type/feat,priority/P1"

# 3) RLS + secure views
create_issue \
  "security(db): enable RLS and secure read views" \
  "Policies for submissions/votes/participants/rounds; tests for visibility before/after publish." \
  "M1" \
  "area/db,type/security,priority/P0"

# 4) Schema/contract alignment (done; trackable)
create_issue \
  "chore: unify phase enums across DB/Server/CLI/Web" \
  "Align to submit|published|final; update Zod & tests; document mapping if needed." \
  "M1" \
  "area/server,area/cli,area/web,type/chore,priority/P1"

# 5) JCS canonicalization
create_issue \
  "feat(provenance): adopt RFC 8785 JCS canonicalization" \
  "Implement JCS in server/CLI; add vector tests; ensure DB invariants on canonical_sha256." \
  "M2" \
  "area/server,area/cli,type/feat,priority/P0"

# 6) Server-issued submission nonces
create_issue \
  "feat(security): server-issued submission nonces (issue + enforce)" \
  "Add nonce endpoint/table; enforce single-use; return 409 on invalid; tests + pgTAP." \
  "M2" \
  "area/server,area/db,type/feat,priority/P0"

# 7) SSH/Ed25519 provenance
create_issue \
  "feat(provenance): SSH/Ed25519 signature verification + challenge" \
  "Implement /auth/challenge & /auth/verify; ssh-keygen -Y verify; CLI --sign; tests." \
  "M2" \
  "area/server,area/cli,type/feat,priority/P0"

# 8) Journals + CLI verify
create_issue \
  "feat(journal): round chain hash + server signature + CLI verify" \
  "Write per-round journal; serve via /journal; implement CLI verify; add deterministic tests." \
  "M2" \
  "area/worker,area/server,area/cli,type/feat,priority/P1"

# 9) Fact-check/verify phase
create_issue \
  "feat(verify): per-claim verdicts + moderator workflows" \
  "Tables/RPCs/UI; realtime updates; /state integration; tests." \
  "M3" \
  "area/web,area/server,area/db,type/feat,priority/P1"

# 10) CI/pgTAP and checks
create_issue \
  "chore(ci): expand pgTAP for RLS, triggers, nonces; document required checks" \
  "Add pgTAP for new invariants; workflow toggle; ensure Ruleset check names match." \
  "M7" \
  "area/ci,type/chore,priority/P1"

echo "Done. Optionally add to project: gh project item-add <project-number> --url <issue-url>"

