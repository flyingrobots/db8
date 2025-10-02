# feedback

Please complete every item in this list. When you finish an item, update this document to check it off. The add everything in git and commit with an appropriate git commit message. When you are fully finished and this document has no incomplete items in the checklist, git add -A and git commit with good message, then git push. Open a new PR.

# checklist

- [x] In bin/db8.js around lines 509 to 537, the payload currently includes
      participant and submit-minutes values without validating them (which allows
      NaN/null/0 into the request). Validate args.participants and
      args['submit-minutes'] before adding to cfg: parse them to numbers, ensure they
      are finite integers and within sensible ranges (e.g. participants is an integer

  > = 1, submit-minutes is an integer >= 0), and if validation fails print the same
  > validation error/usage and return EXIT.VALIDATION; only add fields to cfg when
  > validated, and omit the entire cfg block from the payload if it remains empty.
  > Also keep returning EXIT.VALIDATION on bad inputs rather than sending the
  > request.

- [x] In bin/db8.js around lines 508 to 556, the CLI currently allows --submit-minutes
      of 0 while the server schema requires a minimum of 1; change the validation to
      reject values less than 1 (use m < 1) and update the error message to state
      '--submit-minutes must be an integer between 1 and 1440' so the CLI matches the
      server schema; keep the rest of the logic that assigns cfg.submit_minutes when
      valid.

- [x] In bin/db8.js around lines 510 to 513, the topic validation is fragile and
      inconsistent with the server schema: ensure you first check that topic is a
      string, and then count Unicode code points rather than JS .length to align with
      the schema’s character counting; replace the existing condition (and remove the
      redundant !topic) with a check like "typeof topic !== 'string' ||
      Array.from(topic).length < 3" (or use the spread operator) so non-string values
      are rejected before measuring length and multibyte characters (e.g. emoji) are
      counted correctly, then leave the existing error message and return
      EXIT.VALIDATION.

- [x] In bin/db8.js around line 535, the code wraps the nonce in an unnecessary
      String() call; remove the defensive String() so the property is assigned
      directly as client_nonce: args.nonce || randomNonce(), relying on parseArgs to
      provide a string or undefined and randomNonce() to return a string.

- [x] In server/rpc.js around lines 188 to 235, the DB-fallback logging is
      inconsistent: line ~205 uses console.error while submission.create uses
      console.warn; change the console.error call that logs "room.create DB error;
      using in-memory fallback" to console.warn (preserving the same message and error
      object) so all fallback scenarios use the same log level.

- [x] In server/rpc.js around line 210, remove the String(...) coercion that converts
      non-string values into garbage; instead read the validated field directly (e.g.,
      use input.client_nonce as-is, or use nullish coalescing if you must default to
      an empty string) so you don't mask type errors — replace the current line with a
      direct access to input.client_nonce (or input.client_nonce ?? '').

- [x] In server/test/cli.room.create.test.js around lines 35 to 37, the try-catch that
      calls child.kill() silently ignores any errors; change the catch to log the
      error (e.g., console.warn with a clear message and the caught error) so failures
      to kill the child are visible in test output, but keep swallowing the error
      afterward to preserve existing timeout behavior.
