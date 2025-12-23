-- db/rpc.sql — SQL RPCs for room lifecycle, idempotent submissions, and round operations
-- room_create parameters:
--   participant_count: default 4, allowed range [1..64]
--   submit_minutes:    default 5, allowed range [1..1440]
--   client_nonce:      optional idempotency token; reuse to get the same room_id

CREATE OR REPLACE FUNCTION room_create(
  p_topic text,
  p_cfg jsonb DEFAULT '{}'::jsonb,
  p_client_nonce text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_room_id uuid;
  v_participants integer := COALESCE(NULLIF(p_cfg->>'participant_count', '')::int, 4);
  v_submit_minutes integer := COALESCE(NULLIF(p_cfg->>'submit_minutes', '')::int, 5);
  v_now bigint := extract(epoch from now())::bigint;
  v_submit_deadline bigint;
  v_client_nonce text := NULLIF(p_client_nonce, '');
BEGIN
  IF v_participants < 1 OR v_participants > 64 THEN
    RAISE EXCEPTION 'participant_count out of range [1..64]: %', v_participants
      USING ERRCODE = '22023';
  END IF;

  IF v_submit_minutes < 1 OR v_submit_minutes > 1440 THEN
    RAISE EXCEPTION 'submit_minutes out of range [1..1440]: %', v_submit_minutes
      USING ERRCODE = '22023';
  END IF;

  v_submit_deadline := v_now + (v_submit_minutes::bigint * 60);

  INSERT INTO rooms (title, client_nonce)
  VALUES (NULLIF(p_topic, ''), v_client_nonce)
  ON CONFLICT (client_nonce)
    DO UPDATE SET title = COALESCE(rooms.title, EXCLUDED.title)
  RETURNING id INTO v_room_id;

  INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
  VALUES (v_room_id, 0, 'submit', v_submit_deadline)
  ON CONFLICT (room_id, idx) DO NOTHING;

  INSERT INTO participants (room_id, anon_name, role)
  SELECT v_room_id, format('agent_%s', gs), 'debater'
  FROM generate_series(1, v_participants) AS gs
  ON CONFLICT (room_id, anon_name) DO NOTHING;

  RETURN v_room_id;
END;
$$;

-- Atomic submission upsert that consumes nonce within the same transaction
CREATE OR REPLACE FUNCTION submission_upsert_with_nonce(
  p_round_id uuid,
  p_author_id uuid,
  p_content text,
  p_claims jsonb,
  p_citations jsonb,
  p_canonical_sha256 text,
  p_client_nonce text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM submission_nonce_consume(p_round_id, p_author_id, p_client_nonce);
  SELECT submission_upsert(p_round_id, p_author_id, p_content, p_claims, p_citations, p_canonical_sha256, p_client_nonce)
    INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION submission_upsert(
  p_round_id uuid,
  p_author_id uuid,
  p_content text,
  p_claims jsonb,
  p_citations jsonb,
  p_canonical_sha256 text,
  p_client_nonce text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE 
  v_id uuid;
  v_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM submissions 
    WHERE round_id = p_round_id AND author_id = p_author_id AND client_nonce = p_client_nonce
  ) INTO v_exists;

  INSERT INTO submissions (round_id, author_id, content, claims, citations, status,
                           submitted_at, canonical_sha256, client_nonce)
  VALUES (p_round_id, p_author_id, p_content, p_claims, p_citations,
          'submitted', now(), p_canonical_sha256, p_client_nonce)
  ON CONFLICT (round_id, author_id, client_nonce)
  DO UPDATE SET canonical_sha256 = EXCLUDED.canonical_sha256
  RETURNING id INTO v_id;

  PERFORM admin_audit_log_write(
    CASE WHEN v_exists THEN 'update' ELSE 'create' END,
    'submission',
    v_id,
    p_author_id,
    NULL,
    jsonb_build_object('client_nonce', p_client_nonce),
    jsonb_build_object('canonical_sha256', p_canonical_sha256)
  );

  RETURN v_id;
END;
$$;

-- Note: test-only deadline helpers now live in db/test/helpers.sql.

CREATE OR REPLACE FUNCTION vote_submit(
  p_round_id uuid,
  p_voter_id uuid,
  p_kind text,
  p_ballot jsonb,
  p_client_nonce text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_phase text;
  v_is_participant boolean;
  now_unix bigint := extract(epoch from now())::bigint;
BEGIN
  IF p_kind <> 'continue' THEN
    RAISE EXCEPTION 'unsupported vote kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  -- Verify round exists and is in a voteable phase
  SELECT phase INTO v_phase
    FROM rounds
   WHERE id = p_round_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round not found: %', p_round_id USING ERRCODE = '22023';
  END IF;

  IF v_phase NOT IN ('published') THEN
    RAISE EXCEPTION 'round not in voteable phase: %', v_phase USING ERRCODE = '22023';
  END IF;

  -- Ensure the continue-vote window is still open, if present
  IF EXISTS (
       SELECT 1 FROM rounds r
        WHERE r.id = p_round_id
          AND r.continue_vote_close_unix IS NOT NULL
          AND r.continue_vote_close_unix < now_unix
     ) THEN
    RAISE EXCEPTION 'voting window closed for round: %', p_round_id USING ERRCODE = '22023';
  END IF;

  -- Verify voter is a participant in the round's room
  SELECT EXISTS (
           SELECT 1
             FROM participants p
             JOIN rounds r ON r.room_id = p.room_id
            WHERE p.id = p_voter_id
              AND r.id = p_round_id
         )
    INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'voter not a participant in round: %', p_voter_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO votes (round_id, voter_id, kind, ballot, client_nonce)
  VALUES (p_round_id, p_voter_id, p_kind, p_ballot, p_client_nonce)
  ON CONFLICT (round_id, voter_id, kind, client_nonce)
  DO UPDATE SET ballot = EXCLUDED.ballot
  RETURNING id INTO v_id;

  PERFORM admin_audit_log_write(
    'vote',
    'vote',
    v_id,
    p_voter_id,
    NULL,
    jsonb_build_object('client_nonce', p_client_nonce),
    jsonb_build_object('kind', p_kind, 'ballot', p_ballot)
  );

  RETURN v_id;
END;
$$;

-- Minimal round ops — safe no-ops if no matching rows
CREATE OR REPLACE FUNCTION round_publish_due() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE 
  now_unix bigint := extract(epoch from now())::bigint;
  v_round record;
BEGIN
  FOR v_round IN 
    UPDATE rounds SET
      phase = 'published',
      published_at_unix = now_unix,
      continue_vote_close_unix = now_unix + 30::bigint
    WHERE phase = 'submit' AND submit_deadline_unix > 0 AND submit_deadline_unix < now_unix
    RETURNING id, room_id, idx
  LOOP
    PERFORM admin_audit_log_write(
      'publish',
      'round',
      v_round.id,
      NULL,
      'watcher',
      jsonb_build_object('room_id', v_round.room_id, 'idx', v_round.idx),
      jsonb_build_object('phase', 'published')
    );
  END LOOP;
END;
$$;

-- Admin audit log write path (privileged). Inserts a constrained row and returns its id.
-- Intended for service/worker use; relies on table CHECK constraints for action/entity_type.
-- SECURITY DEFINER so it can write despite RLS lockdown on admin_audit_log.
CREATE OR REPLACE FUNCTION admin_audit_log_write(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_system_actor text DEFAULT NULL,
  p_actor_context jsonb DEFAULT '{}'::jsonb,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  -- Exactly one of actor_id or system_actor
  IF (p_actor_id IS NULL AND (p_system_actor IS NULL OR p_system_actor = '')) OR
     (p_actor_id IS NOT NULL AND p_system_actor IS NOT NULL) THEN
    RAISE EXCEPTION 'exactly one of actor_id or system_actor must be set' USING ERRCODE = '22023';
  END IF;

  -- Validate enums early (also enforced by table CHECKs)
  IF p_action NOT IN ('create','update','delete','publish','open_next','vote','flag','login','logout','config','rls','rpc') THEN
    RAISE EXCEPTION 'invalid action: %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_entity_type NOT IN ('room','round','submission','vote','participant','flag','system') THEN
    RAISE EXCEPTION 'invalid entity_type: %', p_entity_type USING ERRCODE = '22023';
  END IF;

  INSERT INTO admin_audit_log(action, entity_type, entity_id, actor_id, system_actor, actor_context, details)
  VALUES (p_action, p_entity_type, p_entity_id, p_actor_id, NULLIF(p_system_actor, ''), COALESCE(p_actor_context, '{}'::jsonb), COALESCE(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION round_open_next() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE 
  now_unix bigint := extract(epoch from now())::bigint;
  v_rec record;
BEGIN
  -- We'll use a temporary table to store what happened so we can log it
  CREATE TEMP TABLE IF NOT EXISTS _round_transitions (
    round_id uuid,
    room_id uuid,
    idx integer,
    action text, -- 'final' or 'open_next'
    yes_votes integer,
    no_votes integer
  ) ON COMMIT DROP;
  TRUNCATE _round_transitions;

  WITH due AS (
    SELECT r.* FROM rounds r
    WHERE r.phase = 'published'
      AND r.continue_vote_close_unix IS NOT NULL
      AND r.continue_vote_close_unix < now_unix
  ), tallied AS (
    SELECT d.room_id,
           d.id AS round_id,
           d.idx,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'continue' THEN 1 ELSE 0 END), 0)::int AS yes,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'end' THEN 1 ELSE 0 END), 0)::int AS no
    FROM due d
    LEFT JOIN votes v ON v.round_id = d.id
    GROUP BY d.room_id, d.id, d.idx
  ), losers AS (
    UPDATE rounds r
    SET phase = 'final'
    FROM tallied t
    WHERE r.id = t.round_id
      AND t.yes <= t.no
    RETURNING r.id, r.room_id, r.idx, t.yes, t.no
  )
  INSERT INTO _round_transitions (round_id, room_id, idx, action, yes_votes, no_votes)
  SELECT id, room_id, idx, 'final', yes, no FROM losers;

  WITH tallied AS (
    SELECT d.room_id,
           d.id AS round_id,
           d.idx,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'continue' THEN 1 ELSE 0 END), 0)::int AS yes,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'end' THEN 1 ELSE 0 END), 0)::int AS no
    FROM rounds d
    LEFT JOIN votes v ON v.round_id = d.id
    WHERE d.phase = 'published'
      AND d.continue_vote_close_unix IS NOT NULL
      AND d.continue_vote_close_unix < now_unix
    GROUP BY d.room_id, d.id, d.idx
  ), winners AS (
    INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
    SELECT t.room_id,
           t.idx + 1,
           'submit',
           now_unix + 300::bigint
    FROM tallied t
    WHERE t.yes > t.no
    ON CONFLICT (room_id, idx) DO NOTHING
    RETURNING id, room_id, idx
  )
  INSERT INTO _round_transitions (round_id, room_id, idx, action)
  SELECT id, room_id, idx, 'open_next' FROM winners;

  -- Now log everything from the temp table
  FOR v_rec IN SELECT * FROM _round_transitions LOOP
    PERFORM admin_audit_log_write(
      CASE WHEN v_rec.action = 'final' THEN 'update' ELSE 'open_next' END,
      'round',
      v_rec.round_id,
      NULL,
      'watcher',
      jsonb_build_object('room_id', v_rec.room_id, 'idx', v_rec.idx),
      jsonb_build_object('action', v_rec.action, 'yes', v_rec.yes_votes, 'no', v_rec.no_votes)
    );

    -- If we hit 'final', mark the room as closed
    IF v_rec.action = 'final' THEN
      UPDATE rooms SET status = 'closed' WHERE id = v_rec.room_id;
      PERFORM admin_audit_log_write(
        'update',
        'room',
        v_rec.room_id,
        NULL,
        'watcher',
        jsonb_build_object('status', 'closed'),
        jsonb_build_object('reason', 'final_vote_completed')
      );
    END IF;
  END LOOP;
END;
$$;

-- Views
CREATE OR REPLACE VIEW view_current_round AS
  SELECT DISTINCT ON (room_id) room_id, id as round_id, idx, phase, submit_deadline_unix, published_at_unix, continue_vote_close_unix
  FROM rounds
  ORDER BY room_id, idx DESC;

CREATE OR REPLACE VIEW view_continue_tally AS
  SELECT r.room_id, r.id as round_id,
    COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END), 0) AS yes,
    COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END), 0) AS no
  FROM rounds r
  LEFT JOIN votes v ON v.round_id = r.id
  GROUP BY r.room_id, r.id;

-- Read-only views for safe consumption (RLS-ready)
CREATE OR REPLACE VIEW submissions_view AS
  SELECT
    s.id,
    r.room_id,
    s.round_id,
    CASE 
      WHEN (rm.config->>'attribution_mode') = 'masked' 
           AND r.phase = 'submit' 
           AND s.author_id <> db8_current_participant_id()
      THEN NULL -- Hidden during submit if masked
      WHEN (rm.config->>'attribution_mode') = 'masked'
      THEN p.id -- We still return the internal id but UI will use anon_name
      ELSE s.author_id 
    END as author_id,
    p.anon_name as author_anon_name,
    s.content,
    s.canonical_sha256,
    s.submitted_at
  FROM submissions s
  JOIN rounds r ON r.id = s.round_id
  JOIN rooms rm ON rm.id = r.room_id
  JOIN participants p ON p.id = s.author_id;

CREATE OR REPLACE VIEW votes_view AS
  SELECT
    v.id,
    r.room_id,
    v.round_id,
    v.voter_id,
    v.kind,
    v.ballot,
    v.created_at
  FROM votes v
  JOIN rounds r ON r.id = v.round_id;

CREATE OR REPLACE VIEW participants_view AS
  SELECT id, room_id, anon_name, role, ssh_fingerprint, created_at
  FROM participants;

CREATE OR REPLACE VIEW rounds_view AS
  SELECT id, room_id, idx, phase, submit_deadline_unix, published_at_unix, continue_vote_close_unix
  FROM rounds;

-- Aggregated submissions with flags for secure consumption
CREATE OR REPLACE VIEW submissions_with_flags_view AS
  SELECT
    s.id,
    r.room_id,
    s.round_id,
    CASE 
      WHEN (rm.config->>'attribution_mode') = 'masked' 
           AND r.phase = 'submit' 
           AND s.author_id <> db8_current_participant_id()
      THEN NULL 
      WHEN (rm.config->>'attribution_mode') = 'masked'
      THEN p.id
      ELSE s.author_id 
    END as author_id,
    p.anon_name as author_anon_name,
    s.content,
    s.canonical_sha256,
    s.submitted_at,
    COALESCE(f.flag_count, 0) AS flag_count,
    COALESCE(f.flag_details, '[]'::jsonb) AS flag_details
  FROM submissions s
  JOIN rounds r ON r.id = s.round_id
  JOIN rooms rm ON rm.id = r.room_id
  JOIN participants p ON p.id = s.author_id
  LEFT JOIN (
    SELECT sf.submission_id,
           COUNT(*) AS flag_count,
           jsonb_agg(
             jsonb_build_object(
               'reporter_id', sf.reporter_id,
               'reporter_role', sf.reporter_role,
               'reason', sf.reason,
               'created_at', extract(epoch from sf.created_at)::bigint
             )
             ORDER BY sf.created_at DESC
           ) AS flag_details
      FROM submission_flags sf
      JOIN submissions s2 ON s2.id = sf.submission_id
      JOIN rounds rr ON rr.id = s2.round_id
     WHERE rr.phase = 'published'
     GROUP BY sf.submission_id
  ) f ON f.submission_id = s.id;

-- Harden views to avoid qual pushdown across RLS boundaries
ALTER VIEW submissions_view SET (security_barrier = true);
ALTER VIEW votes_view SET (security_barrier = true);
ALTER VIEW participants_view SET (security_barrier = true);
ALTER VIEW rounds_view SET (security_barrier = true);
ALTER VIEW submissions_with_flags_view SET (security_barrier = true);

-- Notify function
CREATE OR REPLACE FUNCTION notify_rounds_change() RETURNS trigger AS $fn$
DECLARE
  r record;
BEGIN
  r := COALESCE(NEW, OLD);
  PERFORM pg_notify(
    'db8_rounds',
    json_build_object(
      't', 'phase',
      'room_id', r.room_id::text,
      'round_id', r.id::text,
      'idx', r.idx,
      'phase', r.phase,
      'submit_deadline_unix', r.submit_deadline_unix,
      'published_at_unix', r.published_at_unix,
      'continue_vote_close_unix', r.continue_vote_close_unix
    )::text
  );
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

-- Drop and recreate trigger to avoid duplicates across repeated test runs
DROP TRIGGER IF EXISTS trg_rounds_notify_change ON rounds;
CREATE TRIGGER trg_rounds_notify_change
AFTER INSERT OR UPDATE ON rounds
FOR EACH ROW
EXECUTE PROCEDURE notify_rounds_change();

-- M2: server-issued submission nonces
CREATE OR REPLACE FUNCTION submission_nonce_issue(
  p_round_id uuid,
  p_author_id uuid,
  p_ttl_seconds int DEFAULT 600
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nonce text := gen_random_uuid()::text;
BEGIN
  INSERT INTO submission_nonces(round_id, author_id, nonce, issued_at, expires_at)
  VALUES (p_round_id, p_author_id, v_nonce, now(), CASE WHEN p_ttl_seconds > 0 THEN now() + (p_ttl_seconds * interval '1 second') ELSE NULL END);
  RETURN v_nonce;
END;
$$;

CREATE OR REPLACE FUNCTION submission_nonce_consume(
  p_round_id uuid,
  p_author_id uuid,
  p_nonce text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE submission_nonces
     SET consumed_at = now()
   WHERE round_id = p_round_id
     AND author_id = p_author_id
     AND nonce = p_nonce
     AND (expires_at IS NULL OR expires_at > now())
     AND consumed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'invalid_nonce' USING ERRCODE = '22023';
  END IF;
  RETURN true;
END;
$$;

-- Journal upsert
CREATE OR REPLACE FUNCTION journal_upsert(
  p_room_id uuid,
  p_round_idx int,
  p_hash text,
  p_signature jsonb,
  p_core jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_round_idx < 0 THEN
    RAISE EXCEPTION 'invalid_round_idx' USING ERRCODE = '22023';
  END IF;
  INSERT INTO journals(room_id, round_idx, hash, signature, core)
  VALUES (p_room_id, p_round_idx, p_hash, COALESCE(p_signature, '{}'::jsonb), COALESCE(p_core, '{}'::jsonb))
  ON CONFLICT (room_id, round_idx)
  DO UPDATE SET hash = EXCLUDED.hash, signature = EXCLUDED.signature, core = EXCLUDED.core;

  -- Notify listeners that a new/updated journal is available for this room/round
  PERFORM pg_notify(
    'db8_journal',
    json_build_object(
      't', 'journal',
      'room_id', p_room_id::text,
      'idx', p_round_idx,
      'hash', p_hash
    )::text
  );
END;
$$;

-- Participant fingerprint enrollment: accepts DER SPKI base64 or sha256:<hex>,
-- normalizes to 'sha256:<hex>' and updates participants.ssh_fingerprint.
CREATE OR REPLACE FUNCTION participant_fingerprint_set(
  p_id uuid,
  p_input text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_hex text;
  v_rows int := 0;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'participant_not_found' USING ERRCODE = '22023';
  END IF;
  IF p_input IS NULL OR length(trim(p_input)) = 0 THEN
    RAISE EXCEPTION 'invalid_fingerprint_or_key' USING ERRCODE = '22023';
  END IF;

  -- Case 1: explicit sha256:<hex> or plain 64-hex
  IF p_input ~ '^(sha256:)?[0-9a-fA-F]{64}$' THEN
    v_hex := lower(replace(p_input, 'sha256:', ''));
    v_norm := 'sha256:' || v_hex;
  ELSE
    -- Case 2: try base64 decode and hash
    BEGIN
      v_hex := encode(digest(decode(p_input, 'base64'), 'sha256'), 'hex');
      v_norm := 'sha256:' || v_hex;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_fingerprint_or_key' USING ERRCODE = '22023';
    END;
  END IF;

  UPDATE participants SET ssh_fingerprint = v_norm WHERE id = p_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'participant_not_found' USING ERRCODE = '22023';
  END IF;
  RETURN v_norm;
END;
$$;

-- M3: Verification RPCs
-- verify_submit: upsert a verdict for a (round, reporter, submission, claim)
CREATE OR REPLACE FUNCTION verify_submit(
  p_round_id uuid,
  p_reporter_id uuid,
  p_submission_id uuid,
  p_claim_id text,
  p_verdict text,
  p_rationale text,
  p_client_nonce text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_phase text;
  v_room uuid;
  v_room_r uuid;
  v_role text;
BEGIN
  -- Enforce allowed verdicts (also via CHECK)
  IF p_verdict NOT IN ('true','false','unclear','needs_work') THEN
    RAISE EXCEPTION 'invalid_verdict' USING ERRCODE = '22023';
  END IF;

  -- Ensure submission belongs to the provided round
  PERFORM 1 FROM submissions s WHERE s.id = p_submission_id AND s.round_id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission_round_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Round must be published or final
  SELECT phase, room_id INTO v_phase, v_room FROM rounds WHERE id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_phase NOT IN ('published','final') THEN
    RAISE EXCEPTION 'round_not_verifiable' USING ERRCODE = '22023';
  END IF;

  -- Reporter must be a participant in the same room and role judge/host
  SELECT p.role, r.room_id
    INTO v_role, v_room_r
    FROM participants p
    JOIN rounds r ON r.room_id = p.room_id
   WHERE p.id = p_reporter_id
     AND r.id = p_round_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reporter_not_participant' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('judge','host') THEN
    RAISE EXCEPTION 'reporter_role_denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO verification_verdicts (round_id, submission_id, reporter_id, claim_id, verdict, rationale, client_nonce)
  VALUES (p_round_id, p_submission_id, p_reporter_id, NULLIF(p_claim_id, ''), p_verdict, NULLIF(p_rationale, ''), NULLIF(p_client_nonce, ''))
  ON CONFLICT (round_id, reporter_id, submission_id, coalesce(claim_id, ''))
  DO UPDATE SET verdict = EXCLUDED.verdict, rationale = COALESCE(EXCLUDED.rationale, verification_verdicts.rationale)
  RETURNING id INTO v_id;

  -- Notify listeners that a new verdict is available
  PERFORM pg_notify(
    'db8_verdict',
    json_build_object(
      't', 'verdict',
      'room_id', v_room::text,
      'round_id', p_round_id::text,
      'submission_id', p_submission_id::text,
      'claim_id', p_claim_id,
      'verdict', p_verdict
    )::text
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE VIEW verification_verdicts_view AS
  SELECT v.id, r.room_id, v.round_id, v.submission_id, v.reporter_id, v.claim_id, v.verdict, v.rationale, v.created_at
  FROM verification_verdicts v
  JOIN rounds r ON r.id = v.round_id;
ALTER VIEW verification_verdicts_view SET (security_barrier = true);

-- verify_summary: aggregated verdict counts per submission and claim within a round
CREATE OR REPLACE FUNCTION verify_summary(
  p_round_id uuid
) RETURNS TABLE (
  submission_id uuid,
  claim_id text,
  true_count int,
  false_count int,
  unclear_count int,
  needs_work_count int,
  total int
)
LANGUAGE sql
AS $$
  SELECT
    v.submission_id,
    v.claim_id,
    SUM(CASE WHEN v.verdict = 'true' THEN 1 ELSE 0 END)::int AS true_count,
    SUM(CASE WHEN v.verdict = 'false' THEN 1 ELSE 0 END)::int AS false_count,
    SUM(CASE WHEN v.verdict = 'unclear' THEN 1 ELSE 0 END)::int AS unclear_count,
    SUM(CASE WHEN v.verdict = 'needs_work' THEN 1 ELSE 0 END)::int AS needs_work_count,
    COUNT(*)::int AS total
  FROM verification_verdicts_view v
  WHERE v.round_id = p_round_id
  GROUP BY v.submission_id, v.claim_id
  ORDER BY v.submission_id, v.claim_id NULLS FIRST;
$$;

-- vote_final_submit: record a final approval/ranking vote
CREATE OR REPLACE FUNCTION vote_final_submit(
  p_round_id uuid,
  p_voter_id uuid,
  p_approval boolean,
  p_ranking jsonb DEFAULT '[]'::jsonb,
  p_client_nonce text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_is_participant boolean;
BEGIN
  -- Verify voter is a participant in the round's room
  SELECT EXISTS (
           SELECT 1
             FROM participants p
             JOIN rounds r ON r.room_id = p.room_id
            WHERE p.id = p_voter_id
              AND r.id = p_round_id
         )
    INTO v_is_participant;

  IF NOT v_is_participant THEN
    RAISE EXCEPTION 'voter not a participant in round: %', p_voter_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO final_votes (round_id, voter_id, approval, ranking, client_nonce)
  VALUES (p_round_id, p_voter_id, p_approval, COALESCE(p_ranking, '[]'::jsonb), COALESCE(p_client_nonce, gen_random_uuid()::text))
  ON CONFLICT (round_id, voter_id, client_nonce)
  DO UPDATE SET approval = EXCLUDED.approval, ranking = EXCLUDED.ranking
  RETURNING id INTO v_id;

  -- Notify listeners
  PERFORM pg_notify(
    'db8_final_vote',
    json_build_object(
      't', 'final_vote',
      'room_id', (SELECT room_id FROM rounds WHERE id = p_round_id)::text,
      'round_id', p_round_id::text,
      'voter_id', p_voter_id::text,
      'approval', p_approval
    )::text
  );

  PERFORM admin_audit_log_write(
    'vote',
    'vote',
    v_id,
    p_voter_id,
    NULL,
    jsonb_build_object('client_nonce', p_client_nonce),
    jsonb_build_object('approval', p_approval, 'ranking', p_ranking)
  );

  RETURN v_id;
END;
$$;

-- score_submit: record rubric scores from a judge for a participant
CREATE OR REPLACE FUNCTION score_submit(
  p_round_id uuid,
  p_judge_id uuid,
  p_participant_id uuid,
  p_e integer, p_r integer, p_c integer, p_v integer, p_y integer,
  p_client_nonce text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_judge_role text;
BEGIN
  -- Verify judge is actually a judge or host
  SELECT role INTO v_judge_role FROM participants WHERE id = p_judge_id;
  IF v_judge_role NOT IN ('judge','host') THEN
    RAISE EXCEPTION 'only judges or hosts can submit rubric scores' USING ERRCODE = '42501';
  END IF;

  INSERT INTO scores (round_id, judge_id, participant_id, e, r, c, v, y, client_nonce)
  VALUES (p_round_id, p_judge_id, p_participant_id, p_e, p_r, p_c, p_v, p_y, COALESCE(p_client_nonce, gen_random_uuid()::text))
  ON CONFLICT (round_id, judge_id, participant_id, client_nonce)
  DO UPDATE SET e = EXCLUDED.e, r = EXCLUDED.r, c = EXCLUDED.c, v = EXCLUDED.v, y = EXCLUDED.y
  RETURNING id INTO v_id;

  PERFORM admin_audit_log_write(
    'update',
    'submission', -- conceptually scoring a submission
    p_participant_id,
    p_judge_id,
    NULL,
    jsonb_build_object('client_nonce', p_client_nonce),
    jsonb_build_object('e', p_e, 'r', p_r, 'c', p_c, 'v', p_v, 'y', p_y)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE VIEW view_score_aggregates AS
  SELECT
    round_id,
    participant_id,
    AVG(e) as avg_e,
    AVG(r) as avg_r,
    AVG(c) as avg_c,
    AVG(v) as avg_v,
    AVG(y) as avg_y,
    -- Composite: E*0.35 + R*0.30 + C*0.20 + V*0.05 + Y*0.10
    (AVG(e)*0.35 + AVG(r)*0.30 + AVG(c)*0.20 + AVG(v)*0.05 + AVG(y)*0.10) as composite_score,
    COUNT(judge_id) as judge_count
  FROM scores
  GROUP BY round_id, participant_id;

ALTER VIEW view_score_aggregates SET (security_barrier = true);

CREATE OR REPLACE VIEW view_final_tally AS
  SELECT
    round_id,
    COUNT(*) FILTER (WHERE approval = true) AS approves,
    COUNT(*) FILTER (WHERE approval = false) AS rejects,
    COUNT(*) AS total
  FROM final_votes
  GROUP BY round_id;

ALTER VIEW view_final_tally SET (security_barrier = true);

-- reputation_update_round: deterministic Elo update for a completed round
CREATE OR REPLACE FUNCTION reputation_update_round(
  p_round_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room_id uuid;
  v_tags jsonb;
  v_k integer := 32;
  v_rec record;
  v_opponent record;
  v_expected float;
  v_actual float;
  v_delta float;
BEGIN
  SELECT room_id INTO v_room_id FROM rounds WHERE id = p_round_id;
  SELECT config->'tags' INTO v_tags FROM rooms WHERE id = v_room_id;

  -- For each debater in the round
  FOR v_rec IN 
    SELECT s.participant_id, s.composite_score, COALESCE(r.elo, 1200.0) as current_elo
    FROM view_score_aggregates s
    LEFT JOIN reputation r ON r.participant_id = s.participant_id
    WHERE s.round_id = p_round_id
  LOOP
    -- Compare against all other debaters in the same round
    FOR v_opponent IN
      SELECT s.participant_id, s.composite_score, COALESCE(r.elo, 1200.0) as current_elo
      FROM view_score_aggregates s
      LEFT JOIN reputation r ON r.participant_id = s.participant_id
      WHERE s.round_id = p_round_id AND s.participant_id <> v_rec.participant_id
    LOOP
      -- Elo math
      v_expected := 1.0 / (1.0 + pow(10.0, (v_opponent.current_elo - v_rec.current_elo) / 400.0));
      IF v_rec.composite_score > v_opponent.composite_score THEN
        v_actual := 1.0;
      ELSIF v_rec.composite_score < v_opponent.composite_score THEN
        v_actual := 0.0;
      ELSE
        v_actual := 0.5;
      END IF;
      
      v_delta := v_k * (v_actual - v_expected);
      
      -- Update Global
      INSERT INTO reputation (participant_id, elo)
      VALUES (v_rec.participant_id, 1200.0 + v_delta)
      ON CONFLICT (participant_id) 
      DO UPDATE SET elo = reputation.elo + v_delta, updated_at = now();

      -- Update Tags
      IF v_tags IS NOT NULL AND jsonb_array_length(v_tags) > 0 THEN
        FOR i IN 0..jsonb_array_length(v_tags)-1 LOOP
          INSERT INTO reputation_tag (participant_id, tag, elo)
          VALUES (v_rec.participant_id, v_tags->>i, 1200.0 + v_delta)
          ON CONFLICT (participant_id, tag)
          DO UPDATE SET elo = reputation_tag.elo + v_delta, updated_at = now();
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM admin_audit_log_write(
    'update',
    'system',
    v_room_id,
    NULL,
    'worker',
    jsonb_build_object('round_id', p_round_id),
    jsonb_build_object('action', 'reputation_update')
  );
END;
$$;

-- research_cache_upsert: store a URL snapshot
CREATE OR REPLACE FUNCTION research_cache_upsert(
  p_url text,
  p_url_hash text,
  p_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO research_cache (url, url_hash, snapshot)
  VALUES (p_url, p_url_hash, p_snapshot)
  ON CONFLICT (url_hash) DO UPDATE SET snapshot = EXCLUDED.snapshot;
END;
$$;

-- research_usage_increment: track and enforce fetch quotas
CREATE OR REPLACE FUNCTION research_usage_increment(
  p_room_id uuid,
  p_round_id uuid,
  p_max integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO research_usage (room_id, round_id, fetch_count)
  VALUES (p_room_id, p_round_id, 1)
  ON CONFLICT (room_id, round_id) DO UPDATE SET fetch_count = research_usage.fetch_count + 1
  RETURNING fetch_count INTO v_count;

  IF p_max > 0 AND v_count > p_max THEN
    RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = '22023';
  END IF;

  RETURN v_count;
END;
$$;

-- dlq_push: push a failed payload to the DLQ
CREATE OR REPLACE FUNCTION dlq_push(
  p_payload jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pgmq.send('db8_dlq', p_payload);
END;
$$;

-- heartbeat: signal orchestrator liveness
CREATE OR REPLACE FUNCTION orchestrator_heartbeat(
  p_id text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO orchestrator_heartbeat (id, last_seen_at)
  VALUES (p_id, now())
  ON CONFLICT (id) DO UPDATE SET last_seen_at = now();
END;
$$;

-- recover_abandoned_barrier: cleanup rounds stuck in submit if orchestrator died
CREATE OR REPLACE FUNCTION recover_abandoned_barrier(
  p_timeout_seconds integer DEFAULT 60
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- If no active heartbeats in the last X seconds, assume orchestrator died
  IF NOT EXISTS (
    SELECT 1 FROM orchestrator_heartbeat 
    WHERE last_seen_at > now() - (p_timeout_seconds * interval '1 second')
  ) THEN
    -- CONCEPTUAL: In a real system, we'd take over or force a flip.
    -- For db8 M7, we'll force-publish due rounds that were abandoned.
    PERFORM round_publish_due();
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  RETURN v_count;
END;
$$;
