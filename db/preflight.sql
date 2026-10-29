-- Applied and committed before schema.sql (scripts/prepare-db.js). Only steps
-- that must survive a later failure of schema.sql belong here, and each must
-- be additive and safe with the functions already installed.
--
-- score_nonces: the scores key upgrade in schema.sql can refuse
-- (scores_upgrade_ambiguous), and that rolls the whole file back. The operator
-- then deletes the losing revision. Its nonce must already be recorded here,
-- or a delayed retry of it later overwrites the score that was kept.
-- On a fresh database there are no scores yet; schema.sql creates the table.
DO $$
BEGIN
  IF to_regclass('public.scores') IS NULL THEN
    RETURN;
  END IF;
  CREATE TABLE IF NOT EXISTS score_nonces (
    round_id        uuid        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    judge_id        uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_id  uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    client_nonce    text        NOT NULL,
    PRIMARY KEY (round_id, judge_id, participant_id, client_nonce)
  );
  ALTER TABLE score_nonces ENABLE ROW LEVEL SECURITY;
  INSERT INTO score_nonces (round_id, judge_id, participant_id, client_nonce)
  SELECT round_id, judge_id, participant_id, client_nonce FROM scores
  ON CONFLICT DO NOTHING;
END $$;
