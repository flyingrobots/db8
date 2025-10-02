# feedback

Please complete every item in this list. When you finish an item, update this document to check it off. The add everything in git and commit with an appropriate git commit message. When you are fully finished and this document has no incomplete items in the checklist, git add -A and git commit with good message, then git push. Open a new PR.

# checklist

- [x] package.json 54-54: WHAT THE HELL? Duplicate postinstall field!

You have postinstall defined TWICE in this file (line 11 and line 54). The second one at line 54 is a duplicate top-level field that will OVERRIDE the one in scripts. This is completely broken JSON structure that will cause undefined behavior.

DELETE line 54 immediately. This is embarrassingly sloppy.

- "postinstall": "node -e \"try{require('@rollup/rollup-linux-x64-gnu');process.exit(0)}catch(e){process.exit(1)}\" || npm i @rollup/rollup-linux-x64-gnu@latest || true"

- [x] db/rpc.sql (1)
      120-156: Stop duplicating the CTE circus.

You copy-pasted the due/tallied/winners CTE stack twice in the same function. The next change to tally semantics is guaranteed to rot because someone will touch one branch and forget the other. Collapse this mess into a single data-modifying CTE so we compute tallies once, update losers, and insert winners off the same dataset.

- -- advance published rounds whose continue window closed
- WITH due AS (
- SELECT r.\* FROM rounds r
- WHERE r.phase = 'published' AND r.continue_vote_close_unix IS NOT NULL AND r.continue_vote_close_unix < now_unix
- ), tallied AS (
- SELECT d.room_id, d.id as round_id,
-           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END), 0) AS yes,
-           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END), 0) AS no
- FROM due d
- LEFT JOIN votes v ON v.round_id = d.id
- GROUP BY d.room_id, d.id
- ), winners AS (
- SELECT t.\*, r.idx FROM tallied t JOIN rounds r ON r.id = t.round_id
- )
- UPDATE rounds r SET phase = 'final'
- FROM winners w
- WHERE r.id = w.round_id AND w.yes <= w.no;
-
- -- create next round for winners
- WITH due AS (
- SELECT r.\* FROM rounds r
- WHERE r.phase = 'published' AND r.continue_vote_close_unix IS NOT NULL AND r.continue_vote_close_unix < now_unix
- ), tallied AS (
- SELECT d.room_id, d.id as round_id,
-           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END), 0) AS yes,
-           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END), 0) AS no
- FROM due d
- LEFT JOIN votes v ON v.round_id = d.id
- GROUP BY d.room_id, d.id
- ), winners AS (
- SELECT t.\*, r.idx FROM tallied t JOIN rounds r ON r.id = t.round_id
- )
- INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
- SELECT w.room_id, w.idx + 1, 'submit', now_unix + 300::bigint
- FROM winners w
- WHERE w.yes > w.no
- ON CONFLICT (room_id, idx) DO NOTHING;
  WITH due AS (

* SELECT r.\* FROM rounds r
* WHERE r.phase = 'published'
*      AND r.continue_vote_close_unix IS NOT NULL
*      AND r.continue_vote_close_unix < now_unix
* ), tallied AS MATERIALIZED (
* SELECT d.room_id,
*           d.id AS round_id,
*           r.idx,
*           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'continue' THEN 1 ELSE 0 END), 0) AS yes,
*           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'end' THEN 1 ELSE 0 END), 0) AS no
* FROM due d
* JOIN rounds r ON r.id = d.id
* LEFT JOIN votes v ON v.round_id = d.id
* GROUP BY d.room_id, d.id, r.idx
* ), losers AS (
* UPDATE rounds r
* SET phase = 'final'
* FROM tallied t
* WHERE r.id = t.round_id
*      AND t.yes <= t.no
* RETURNING 1
* )
* INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
* SELECT t.room_id,
*         t.idx + 1,
*         'submit',
*         now_unix + 300::bigint
* FROM tallied t
* WHERE t.yes > t.no
  ON CONFLICT (room_id, idx) DO NOTHING;

- [x] In db/rls.sql around lines 3 to 7, you enabled RLS for rooms, participants,
      rounds, and votes but only created policies for submissions; as a result direct
      SELECTs in tests will be denied. Add explicit RLS policies for those tables
      (rooms, participants, rounds, votes) mirroring the submissions policy logic used
      elsewhere — e.g. allow the service-role or authenticated users via auth
      functions for SELECT/INSERT/UPDATE/DELETE as appropriate, or alternatively route
      all access through security-definer RPCs/service-role functions or temporarily
      disable RLS until policies exist; implement the chosen approach consistently so
      the tests that perform direct selects (watcher.db.flip.test.js line ~42 and
      rpc.db.postgres.test.js line ~114) have permission.

- [x] In db/rls.sql around lines 19 to 29, the RLS policy uses a per-row subquery
      (exists (select 1 from rounds r where r.id = submissions.round_id and r.phase =
      'published')) which will cause severe performance issues on large tables; fix it
      by ensuring there is a supporting index on rounds(id, phase) (create or confirm
      index exists), or better by materializing the round phase on submissions (add a
      submissions.round_phase column kept in sync) or by switching to a view that
      joins submissions to rounds with proper indexing, and at minimum add a clear
      comment above this policy stating the index requirement and advising the
      materialization/view alternatives for performance.

- [x] In docs/Backlog-2025-10-01.md around lines 12 to 25, task #1 is marked complete
      (PR closes #73) but still contains a gh issue create command that would
      duplicate the issue; either remove the entire task entry since the PR closed it,
      or replace the gh issue create command with a reference to the existing issue
      (e.g., change the command to comment/close/associate #73 or update the text to
      "Issue #73 (ADR: SSE...) — closed by this PR") so the backlog accurately
      reflects the issue state and avoids creating duplicates.

- [x] In docs/GettingStarted.md around lines 35–40, the SSE endpoint GET
      /events?room_id=<uuid> lacks detailed specs; update this section to enumerate
      all SSE event types (timer, phase) and include exact JSON payload schemas
      matching server/rpc.js (refer to lines ~342–343 and ~375–376), add examples of
      full SSE frames for each event, document possible error frames and HTTP error
      responses (404, 500) and their JSON bodies, and provide connection/reconnect
      guidance (recommended EventSource retry behavior, timeouts, and
      heartbeat/reconnect examples). Ensure each event lists fields, types, example
      values, and a short note on client handling/idempotency for repeated frames.

- [x] In docs/GettingStarted.md around lines 86 to 96, the watcher setup text is
      duplicated elsewhere; remove the duplicated watcher instructions here and
      replace them with a one-line reference pointing to the single authoritative
      watcher section (ideally located after "Start the server"); update any other
      location to link to that canonical section and ensure GettingStarted.md still
      links to LocalDB.md for DB setup (line 27 already does), so consolidate content
      by keeping only one full watcher walkthrough and converting other occurrences to
      "see section X" links or transclusions.

- [x] server/test/sse.db.events.test.js lines 60-119: the test timeout is set to
      15000ms which is unnecessarily long; shorten it and make the test deterministic
      by either lowering the jest/mocha timeout to 5000ms (or 3000ms) and/or
      eliminating time-based waits by immediately setting DB timestamps so the NOTIFY
      fires instantly (e.g. set published_at_unix and continue_vote_close_unix to now
      and now+1 in the update), or use fake timers to advance time; update the final
      timeout value and/or adjust the DB update values or test harness to ensure
      completion within the shorter timeout.

- [x] In server/test/sse.db.events.test.js around lines 71 to 93, the async onData
      callback calls await pool.query(...) without error handling; wrap that await
      call in a try-catch and on catch call the surrounding Promise's reject (or
      otherwise fail the test) so the test fails fast instead of leaving an unhandled
      rejection and hanging; ensure the catch passes the error to the test harness
      (e.g., reject(err) or done(err) / stream.destroy(err)) and return after handling
      to stop further processing.

- [x] In server/test/watcher.db.flip.test.js around lines 16 to 22, the beforeAll
      blindly executes db/schema.sql and db/rpc.sql which causes race conditions and
      "already exists" errors when test suites run in parallel; change it to first
      query the DB for an existing object (e.g. select to_regclass('public.rooms')
      like in sse.db.events.test.js) and only execute schema.sql and rpc.sql when the
      check returns null (or otherwise create/use a unique schema per suite), ensuring
      you guard schema creation to avoid duplicate loads in concurrent runs.

- [x] In server/test/watcher.db.flip.test.js around lines 27–47, the test inserts a
      room and round but does not remove them afterwards which pollutes DB state and
      can cause conflicts on re-runs; update the test file to either use per-test
      unique IDs (e.g., generate UUIDs) or add proper teardown that deletes the
      inserted rows (or wraps the test in a transaction and rolls back) — implement an
      afterAll/afterEach that deletes the room and round by id (or rolls back the
      transaction) so tests clean up their data and avoid constraint/flakiness issues.

- [x] In server/test/watcher.transitions.test.js around lines 25 to 28, the test is
      currently skipped and suffers from a race between submit and published windows;
      re-enable the test by removing test.skip and make it deterministic by stubbing
      Date.now (or using Jest fake timers) so timestamps used to drive phase
      transitions are controlled. Specifically, replace test.skip with test, set up a
      deterministic clock before the test (e.g., jest.useFakeTimers or mock Date.now)
      to fix nowSec and advance timers/time values explicitly to simulate the submit
      window elapsing and the published window starting, then perform the request and
      assertions; restore timers/mocks after the test to avoid cross-test pollution.
