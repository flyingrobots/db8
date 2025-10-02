# feedback

Please complete every item in this list. When you finish an item, update this document to check it off. The add everything in git and commit with an appropriate git commit message. When you are fully finished and this document has no incomplete items in the checklist, git add -A and git commit with good message, then git push. Open a new PR.

# checklist

- [x] In db/rpc.sql around lines 120 to 151, remove the redundant self-join "JOIN
      rounds r ON r.id = d.id" in the tallied CTE and stop selecting r.idx from that
      join; instead use the columns already present in due (e.g., use d.idx and d.id
      AS round_id), update the SELECT and GROUP BY to reference d.idx and d.id, and
      leave the LEFT JOIN votes and other logic intact so tallied aggregates correctly
      without the unnecessary self-join.

- [x] In server/test/sse.db.events.test.js around lines 88–98, the catch block
      silently rejects on DB error; update it to log the caught error (including
      context like roundId and the failing query/update intent) before performing the
      existing cleanup (res.off('data', onData); res.destroy();) and then reject(e) so
      test failures include diagnostic information for debugging.

- [x] In server/test/sse.db.events.test.js around line 92, the continue-vote close
      window was reduced to 2 seconds which is too short and causes flaky failures;
      restore a safer window (e.g., set the delta to 10–15 seconds instead of 2) and
      then increase the related test timeout (the timeout referenced around line 125)
      so the test waits long enough for DB commit → NOTIFY → LISTEN → SSE → HTTP
      chunks to complete; update both values together to keep the test stable under CI
      latency.

- [x] In server/test/sse.db.events.test.js around lines 92 and 125, the test timeout
      is set to 5 seconds at line 125 but the continue-vote close window is only 2
      seconds at line 92, creating a fragile race; either increase the test timeout to
      a safer value (e.g., 10s) or increase the continue-vote close window so it is
      well within the test timeout with a comfortable margin (recommended: set timeout

  > = window + 5s), and update both lines accordingly so the test timeout and the
  > phase/window durations are consistent and allow for SSE/DB/NOTIFY processing.

- [x] In server/test/watcher.db.flip.test.js around lines 26-59 there are two afterAll
      blocks causing the pool to be closed before the cleanup queries run; merge them
      into a single afterAll that first runs the cleanup queries (await
      pool.query('delete from rounds where id = $1', [roundId]); await
      pool.query('delete from rooms where id = $1', [roomId]);) and then closes the
      pool with await pool.end(); ensure the cleanup queries execute before calling
      pool.end() and remove the duplicate afterAll so only the single combined
      teardown remains.
