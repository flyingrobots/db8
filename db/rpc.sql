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

CREATE OR REPLACE FUNCTION vote_submit(
  p_round_id uuid,
  p_voter_id uuid,
  p_kind text,
  p_ballot jsonb,
  p_client_nonce text
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_kind <> 'continue' THEN
    RAISE EXCEPTION 'unsupported vote kind: %', p_kind USING ERRCODE = '22023';
  END IF;

  INSERT INTO votes (round_id, voter_id, kind, ballot, client_nonce)
  VALUES (p_round_id, p_voter_id, p_kind, p_ballot, p_client_nonce)
  ON CONFLICT (round_id, voter_id, kind, client_nonce)
  DO UPDATE SET ballot = votes.ballot
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

CREATE OR REPLACE FUNCTION round_open_next() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE now_unix bigint := extract(epoch from now())::bigint;
BEGIN
  -- advance published rounds whose continue window closed
  WITH due AS (
    SELECT r.* FROM rounds r
    WHERE r.phase = 'published' AND r.continue_vote_close_unix IS NOT NULL AND r.continue_vote_close_unix < now_unix
  ), tallied AS (
    SELECT d.room_id, d.id as round_id,
           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END), 0) AS yes,
           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END), 0) AS no
    FROM due d
    LEFT JOIN votes v ON v.round_id = d.id
    GROUP BY d.room_id, d.id
  ), winners AS (
    SELECT t.*, r.idx FROM tallied t JOIN rounds r ON r.id = t.round_id
  )
  UPDATE rounds r SET phase = 'final'
  FROM winners w
  WHERE r.id = w.round_id AND w.yes <= w.no;

  -- create next round for winners
  WITH due AS (
    SELECT r.* FROM rounds r
    WHERE r.phase = 'published' AND r.continue_vote_close_unix IS NOT NULL AND r.continue_vote_close_unix < now_unix
  ), tallied AS (
    SELECT d.room_id, d.id as round_id,
           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END), 0) AS yes,
           COALESCE(SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END), 0) AS no
    FROM due d
    LEFT JOIN votes v ON v.round_id = d.id
    GROUP BY d.room_id, d.id
  ), winners AS (
    SELECT t.*, r.idx FROM tallied t JOIN rounds r ON r.id = t.round_id
  )
  INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
  SELECT w.room_id, w.idx + 1, 'submit', now_unix + 300::bigint
  FROM winners w
  WHERE w.yes > w.no
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
