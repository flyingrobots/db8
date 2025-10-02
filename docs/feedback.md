# feedback

Please complete every item in this list. When you finish an item, update this document to check it off. The add everything in git and commit with an appropriate git commit message. When you are fully finished and this document has no incomplete items in the checklist, git add -A and git commit with good message, then git push. Open a new PR.

# checklist

- [ ] In bin/db8.js around lines 509 to 537, the payload currently includes
      participant and submit-minutes values without validating them (which allows
      NaN/null/0 into the request). Validate args.participants and
      args['submit-minutes'] before adding to cfg: parse them to numbers, ensure they
      are finite integers and within sensible ranges (e.g. participants is an integer

  > = 1, submit-minutes is an integer >= 0), and if validation fails print the same
  > validation error/usage and return EXIT.VALIDATION; only add fields to cfg when
  > validated, and omit the entire cfg block from the payload if it remains empty.
  > Also keep returning EXIT.VALIDATION on bad inputs rather than sending the
  > request.

- [ ] In server/rpc.js around lines 184 to 211, the room.create handler falls back to
      an in-memory path on DB error but does not expose the DB error message like
      submission.create does; declare let dbError = null before the DB call, capture
      the caught DB error into dbError inside the inner catch block, and then include
      db_error: dbError?.message || String(dbError) in the fallback JSON response
      (e.g., res.json({ ok: true, room_id, note: 'db_fallback', db_error: ... })) so
      the pattern matches submission.create.

- [ ] In server/rpc.js around lines 197-199, the empty catch block currently swallows
      all database errors; update it to catch the error into a variable and log the
      error before falling back to the in-memory path. Use the module's existing
      logger (or console.error if none) to log a clear contextual message and the
      error object (stack) so DB failures are observable in production, then let the
      code continue to the memory fallback as intended.

- [ ] In server/rpc.js around lines 201 to 207, the in-memory fallback ignores
      client_nonce causing non-idempotent room creation; add a memRoomNonces map
      (declare it at the top with other in-memory stores) and change this block to:
      check if client_nonce exists in memRoomNonces and if so return the existing
      room_id and same response; if not, generate the room_id, initialize memRooms as
      before, then set memRoomNonces.set(client_nonce, room_id) before returning,
      ensuring repeated requests with the same nonce return the original room.

- [ ] In server/rpc.js around lines 204–206, memRooms and SUBMIT_WINDOW_SEC are
      referenced before their later declarations (lines ~273–275); move the
      declarations for memRooms and SUBMIT_WINDOW_SEC up to the top of the file
      immediately after the DB initialization block so they are defined before any
      use, and then remove the duplicate declarations at lines 273–275 to avoid
      confusion and reliance on hoisting.

- [ ] In server/test/cli.room.create.test.js around lines 23–41, the in-promise
      timeout (8000ms) does not match the Jest test timeout (15000ms), which is
      confusing and can cause misleading failures; update the code so both timeouts
      are the same (e.g., change the setTimeout duration from 8000 to 15000) or
      introduce a shared TIMEOUT constant and use it for both the promise and the test
      timeout, or if there is a deliberate reason for differing values, add a one-line
      comment explaining why they differ.

- [ ] In server/test/cli.room.create.test.js around lines 28 to 37, the Promise
      waiting for the child process only reads stdout, never collects stderr, and on
      timeout it rejects without killing the child or checking the child's exit code;
      update the logic to (1) accumulate both stdout and stderr into separate buffers,
      (2) use a single timeout constant (match the test timeout, e.g. 15000ms) and on
      timeout clear listeners, kill the child (child.kill()), and reject with a
      timeout error that includes stderr, (3) on 'close' resolve with an object
      containing stdout, stderr and the numeric exit code (or at least reject if
      exitCode !== 0, including stderr), and (4) attach 'error' handling as before;
      ensure the test then asserts on exit code zero and uses stderr in failure
      messages so errors are visible.

- [ ] In server/test/rpc.room_create.test.js around lines 15 to 18, the test claims
      idempotency but only checks that the second response is a valid string instead
      of asserting it matches the first response; update the code so the nonce-to-room
      mapping is honored in all execution paths (including the in-memory fallback) by
      storing/looking-up the nonce and returning the same room_id for duplicate
      nonces, and change the test to assert
      expect(r2.body.room_id).toBe(r1.body.room_id) (and keep the existing ok/type
      checks).
