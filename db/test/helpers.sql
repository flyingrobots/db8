-- TEST ONLY HELPERS — DO NOT DEPLOY TO PRODUCTION
-- round_set_submit_deadline: adjust submit deadline for deterministic tests
-- Guarded to refuse use if the database name does not indicate a test DB.

CREATE OR REPLACE FUNCTION round_set_submit_deadline(
  p_round_id uuid,
  p_submit_deadline_unix bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF current_database() NOT LIKE '%test%' THEN
    RAISE EXCEPTION 'TEST ONLY: round_set_submit_deadline not available in production'
      USING ERRCODE = '42501';
  END IF;

  UPDATE rounds
     SET submit_deadline_unix = p_submit_deadline_unix
   WHERE id = p_round_id;
END;
$$;

