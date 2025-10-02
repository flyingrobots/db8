-- db/schema.sql — Minimal M1 schema for idempotent submissions and votes
-- Requires: Postgres 13+ (tested on 16 in CI)

-- UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Rooms and Rounds (minimal M1)
CREATE TABLE IF NOT EXISTS rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text,
  client_nonce  text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                   uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  idx                       integer     NOT NULL DEFAULT 0,
  phase                     text        NOT NULL DEFAULT 'submit' CHECK (phase IN ('submit','published','final')),
  submit_deadline_unix      bigint      NOT NULL DEFAULT 0,
  published_at_unix         bigint,
  continue_vote_close_unix  bigint,
  UNIQUE (room_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_rounds_room_idx ON rounds (room_id, idx DESC);
-- Support RLS policy predicate on rounds(id, phase)
CREATE INDEX IF NOT EXISTS idx_rounds_id_phase ON rounds (id, phase);

-- Participants: seeded roster for each room / agent configuration
CREATE TABLE IF NOT EXISTS participants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  anon_name        text        NOT NULL,
  role             text        NOT NULL DEFAULT 'debater' CHECK (role IN ('debater','host','judge')),
  jwt_sub          text,
  ssh_fingerprint  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, anon_name)
);

CREATE INDEX IF NOT EXISTS idx_participants_room ON participants (room_id);

-- Submissions: idempotent by (round_id, author_id, client_nonce)
CREATE TABLE IF NOT EXISTS submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id            uuid        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  author_id           uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  content             text        NOT NULL,
  claims              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  citations           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status              text        NOT NULL DEFAULT 'submitted',
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  canonical_sha256    char(64)    NOT NULL CHECK (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  signature_kind      text,
  signature_b64       text,
  signer_fingerprint  text,
  jwt_sub             text,
  client_nonce        text        NOT NULL,
  UNIQUE (round_id, author_id, client_nonce)
);

-- Votes: idempotent by (round_id, voter_id, kind, client_nonce)
CREATE TABLE IF NOT EXISTS votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  voter_id      uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind          text        NOT NULL CHECK (kind IN ('continue')),
  ballot        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_nonce  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, voter_id, kind, client_nonce)
);

CREATE INDEX IF NOT EXISTS idx_votes_round_kind ON votes (round_id, kind);

-- Submission flags: allow participants/moderators/viewers to report content
CREATE TABLE IF NOT EXISTS submission_flags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reporter_id    text        NOT NULL,
  reporter_role  text        NOT NULL,
  reason         text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_flags_submission ON submission_flags (submission_id);

-- Future M1/M2: rooms/rounds tables, RLS policies, and RPCs

-- Admin audit log: partitioned by time, constrained values, and secure by default
-- Note: recreated here to add constraints, indexes, and partitioning. Safe in dev/CI.
DROP TABLE IF EXISTS admin_audit_log CASCADE;

CREATE TABLE admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     uuid        NOT NULL,
  actor_id      uuid        REFERENCES participants(id) ON DELETE SET NULL,
  system_actor  text,
  actor_context jsonb       NOT NULL DEFAULT '{}'::jsonb,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Prevent typos in action and entity_type (lightweight instead of enums to avoid migrations churn)
  CONSTRAINT admin_audit_action_ck
    CHECK (action IN (
      'create','update','delete','publish','open_next','vote','flag','login','logout','config','rls','rpc'
    )),
  CONSTRAINT admin_audit_entity_type_ck
    CHECK (entity_type IN (
      'room','round','submission','vote','participant','flag','system'
    )),
  -- Exactly one of actor_id or system_actor must be set
  CONSTRAINT admin_audit_actor_oneof_ck
    CHECK ((actor_id IS NOT NULL AND system_actor IS NULL)
        OR (actor_id IS NULL AND system_actor IS NOT NULL))
)
PARTITION BY RANGE (created_at);

-- Default catch-all partition (rotate monthly if/when volume warrants)
CREATE TABLE IF NOT EXISTS admin_audit_log_default PARTITION OF admin_audit_log
  FOR VALUES FROM (MINVALUE) TO (MAXVALUE);

-- Indexes for common filters and recency access
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at_desc ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_time ON admin_audit_log (actor_id, created_at);

COMMENT ON TABLE admin_audit_log IS 'Administrative audit log; RLS locked down. Writes via privileged service only.';
COMMENT ON COLUMN admin_audit_log.actor_context IS 'Additional context about actor (e.g., IP, UA), JSON';
