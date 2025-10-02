---
lastUpdated: 2025-10-02
tags: [spec]
milestone: M6: Research Tools
---

# Research Tools & Cache (M6)

Scope

- Research cache with URL de-duplication (by URL hash) and snapshotting.
- Quotas per room/round; rate limits for fetches.
- Citation builder UI with snippet previews.

Acceptance Criteria

- DB: `research_cache(url, url_hash, snapshot_json, created_at, room_id?,
round_id?)` + unique(url_hash); quota counters per (room, round).
- Server: fetcher that snapshots target content (title, authors, excerpt,
  canonical URL) with timeouts and size caps.
- RLS: room-scoped reads; write limited to service-role or worker.
- Web: editor integration to insert citations, enforce at least two citations,
  and preview snippets.
- CLI (optional): helpers to inspect cache and prefetch URLs.

Tests

- pgTAP: constraints, unique url_hash, quota enforcement hooks.
- Vitest: fetcher behavior, timeouts, and UI validation.

Links

- Features.md → Epic: Research Tools & Cache
- UserStories.md → Attach citations; Research tools

Issues

- #101 feat(web): citation builder + snippet previews
- #102 feat(server): research fetcher with quotas
