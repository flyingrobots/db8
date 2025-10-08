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
DECLARE v_id uuid;
BEGIN
  INSERT INTO submissions (round_id, author_id, content, claims, citations, status,
                           submitted_at, canonical_sha256, client_nonce)
  VALUES (p_round_id, p_author_id, p_content, p_claims, p_citations,
          'submitted', now(), p_canonical_sha256, p_client_nonce)
  ON CONFLICT (round_id, author_id, client_nonce)
  DO UPDATE SET canonical_sha256 = EXCLUDED.canonical_sha256
  RETURNING id INTO v_id;
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
  RETURN v_id;
END;
$$;

-- Minimal round ops — safe no-ops if no matching rows
CREATE OR REPLACE FUNCTION round_publish_due() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE now_unix bigint := extract(epoch from now())::bigint;
BEGIN
  UPDATE rounds SET
    phase = 'published',
    published_at_unix = now_unix,
    continue_vote_close_unix = now_unix + 30::bigint
  WHERE phase = 'submit' AND submit_deadline_unix > 0 AND submit_deadline_unix < now_unix;
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
DECLARE now_unix bigint := extract(epoch from now())::bigint;
BEGIN
  WITH due AS (
    SELECT r.* FROM rounds r
    WHERE r.phase = 'published'
      AND r.continue_vote_close_unix IS NOT NULL
      AND r.continue_vote_close_unix < now_unix
  ), tallied AS MATERIALIZED (
    SELECT d.room_id,
           d.id AS round_id,
           r.idx,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'continue' THEN 1 ELSE 0 END), 0) AS yes,
           COALESCE(SUM(CASE WHEN v.kind = 'continue' AND (v.ballot->>'choice') = 'end' THEN 1 ELSE 0 END), 0) AS no
    FROM due d
    JOIN rounds r ON r.id = d.id
    LEFT JOIN votes v ON v.round_id = d.id
    GROUP BY d.room_id, d.id, r.idx
  ), losers AS (
    UPDATE rounds r
    SET phase = 'final'
    FROM tallied t
    WHERE r.id = t.round_id
      AND t.yes <= t.no
    RETURNING 1
  )
  INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
  SELECT t.room_id,
         t.idx + 1,
         'submit',
         now_unix + 300::bigint
  FROM tallied t
  WHERE t.yes > t.no
  ON CONFLICT (room_id, idx) DO NOTHING;
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
    s.author_id,
    s.content,
    s.canonical_sha256,
    s.submitted_at
  FROM submissions s
  JOIN rounds r ON r.id = s.round_id;

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
  ON CONFLICT (round_id, reporter_id, submission_id, coalesce(claim_id, ''), (COALESCE(NULLIF(client_nonce, ''), '')))
  DO UPDATE SET verdict = EXCLUDED.verdict, rationale = COALESCE(EXCLUDED.rationale, verification_verdicts.rationale)
  RETURNING id INTO v_id;
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

