# feedback

Please complete every item in this list. When you finish an item, update this document to check it off. The add everything in git and commit with an appropriate git commit message. When you are fully finished and this document has no incomplete items in the checklist, git add -A and git commit with good message, then git push. Open a new PR.

# checklist

- [x] db/rpc.sql
      Comment on lines +193 to +221
      -- Aggregated submissions with flags for secure consumption
      CREATE OR REPLACE VIEW submissions_with_flags_view AS
      SELECT
      s.id,
      r.room_id,
      s.round_id,
      s.author_id,
      s.content,
      s.canonical_sha256,
      s.submitted_at,
      COALESCE(f.flag_count, 0) AS flag_count,
      COALESCE(f.flag_details, '[]'::jsonb) AS flag_details
      FROM submissions s
      JOIN rounds r ON r.id = s.round_id
      LEFT JOIN (
      SELECT submission_id,
      COUNT(\*) AS flag_count,
      jsonb_agg(
      jsonb_build_object(
      'reporter_id', reporter_id,
      'reporter_role', reporter_role,
      'reason', reason,
      'created_at', extract(epoch from created_at)::bigint
      )
      ORDER BY created_at DESC
      ) AS flag_details
      FROM submission_flags
      GROUP BY submission_id
      ) f ON f.submission_id = s.id;
      @coderabbitai coderabbitai bot 1 minute ago
      ⚠️ Potential issue | 🔴 Critical

🧩 Analysis chain
Missing row-level security—view is unprotected

There’s ZERO RLS on submissions, rounds, or submission_flags—this view leaks everything. Add

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY submissions_rls ON submissions USING (…);
CREATE POLICY rounds_rls ON rounds USING (…);
CREATE POLICY flags_rls ON submission_flags USING (…);
and mark submissions_with_flags_view as a SECURITY BARRIER.

- [x] In db/test/41_views.pgtap around line 3, the test plan declares plan(4) but
      there are only 3 actual tests; update the plan to match the real number of tests
      by changing plan(4) to plan(3) (or alternatively add a fourth test if intended),
      ensuring the declared test count equals the actual tests to avoid pgTAP
      failures.
