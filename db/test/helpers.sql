-- TEST ONLY HELPERS — DO NOT DEPLOY TO PRODUCTION
-- round_set_submit_deadline: adjust submit deadline for deterministic tests
-- Guarded to refuse use if the database name does not indicate a test DB.

CREATE OR REPLACE FUNCTION round_set_submit_deadline(
  p_round_id uuid,
  p_submit_deadline_unix bigint
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Strict DB-name guard: only allow in databases clearly marked as test.
  -- Accepted patterns: '<prefix>_test' or 'test_<suffix>'.
  IF NOT (
    current_database() LIKE '%\_test' ESCAPE '\' OR
    current_database() LIKE 'test\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'TEST ONLY: round_set_submit_deadline is not available in non-test databases (db=%)', current_database()
      USING ERRCODE = '42501';
  END IF;

  -- Validate inputs
  IF p_round_id IS NULL THEN
    RAISE EXCEPTION 'p_round_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_submit_deadline_unix IS NULL OR p_submit_deadline_unix < 0 OR p_submit_deadline_unix > 4102444800 THEN
    RAISE EXCEPTION 'invalid submit_deadline_unix: % (expected 0..4102444800)', p_submit_deadline_unix USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM rounds WHERE id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found: %', p_round_id USING ERRCODE = '22023';
  END IF;

  UPDATE rounds
     SET submit_deadline_unix = p_submit_deadline_unix
   WHERE id = p_round_id;
END;
$$;

-- TEST ONLY: delete a round by id (teardown helper)
CREATE OR REPLACE FUNCTION round_delete(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    current_database() LIKE '%\_test' ESCAPE '\' OR
    current_database() LIKE 'test\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'TEST ONLY: round_delete is not available in non-test databases (db=%)', current_database()
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM rounds WHERE id = p_round_id;
END;
$$;

-- TEST ONLY: delete a room by id (teardown helper)
CREATE OR REPLACE FUNCTION room_delete(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    current_database() LIKE '%\_test' ESCAPE '\' OR
    current_database() LIKE 'test\_%' ESCAPE '\'
  ) THEN
    RAISE EXCEPTION 'TEST ONLY: room_delete is not available in non-test databases (db=%)', current_database()
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM rooms WHERE id = p_room_id;
END;
$$;
