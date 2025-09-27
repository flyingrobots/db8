-- db/rpc.sql — SQL RPCs for idempotent upserts and round operations

CREATE OR REPLACE FUNCTION room_create(
  p_topic text,
  p_cfg jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_room_id uuid;
  v_participants integer := COALESCE((p_cfg->>'participant_count')::int, 5);
  v_submit_minutes integer := COALESCE((p_cfg->>'submit_minutes')::int, 5);
  v_now integer := extract(epoch from now())::int;
  v_submit_deadline integer := v_now + GREATEST(v_submit_minutes, 1) * 60;
BEGIN
  INSERT INTO rooms (title)
  VALUES (p_topic)
  RETURNING id INTO v_room_id;

  INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
  VALUES (v_room_id, 0, 'submit', v_submit_deadline);

  INSERT INTO participants (room_id, anon_name, role)
  SELECT v_room_id, format('anon_%s', gs), 'debater'
  FROM generate_series(1, GREATEST(v_participants, 1)) AS gs;

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
  p_room_id uuid,
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
  INSERT INTO votes (room_id, round_id, voter_id, kind, ballot, client_nonce)
  VALUES (p_room_id, p_round_id, p_voter_id, p_kind, p_ballot, p_client_nonce)
  ON CONFLICT (round_id, voter_id, kind, client_nonce)
  DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM votes
    WHERE round_id = p_round_id AND voter_id = p_voter_id AND kind = p_kind AND client_nonce = p_client_nonce
    LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- Minimal round ops — safe no-ops if no matching rows
CREATE OR REPLACE FUNCTION round_publish_due() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE now_unix integer := extract(epoch from now())::int;
BEGIN
  UPDATE rounds SET
    phase = 'published',
    published_at_unix = now_unix,
    continue_vote_close_unix = now_unix + 30
  WHERE phase = 'submit' AND submit_deadline_unix > 0 AND submit_deadline_unix < now_unix;
END;
$$;

CREATE OR REPLACE FUNCTION round_open_next() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE now_unix integer := extract(epoch from now())::int;
BEGIN
  -- advance published rounds whose continue window closed
  WITH due AS (
    SELECT r.* FROM rounds r
    WHERE r.phase = 'published' AND r.continue_vote_close_unix IS NOT NULL AND r.continue_vote_close_unix < now_unix
  ), tallied AS (
    SELECT d.room_id, d.id as round_id,
           SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END) AS yes,
           SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END) AS no
    FROM due d
    LEFT JOIN votes v ON v.round_id = d.id
    GROUP BY d.room_id, d.id
  ), winners AS (
    SELECT t.*, r.idx FROM tallied t JOIN rounds r ON r.id = t.round_id
  )
  UPDATE rounds r SET phase = CASE WHEN w.yes > w.no THEN r.phase ELSE 'final' END
  FROM winners w
  WHERE r.id = w.round_id AND w.yes <= w.no;

  -- create next round for winners
  INSERT INTO rounds (room_id, idx, phase, submit_deadline_unix)
  SELECT w.room_id, w.idx + 1, 'submit', now_unix + 300
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
    SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='continue' THEN 1 ELSE 0 END) AS yes,
    SUM(CASE WHEN v.kind='continue' AND (v.ballot->>'choice')='end' THEN 1 ELSE 0 END) AS no
  FROM rounds r
  LEFT JOIN votes v ON v.round_id = r.id
  GROUP BY r.room_id, r.id;
