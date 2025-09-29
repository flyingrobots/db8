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
  submit_deadline_unix      integer     NOT NULL DEFAULT 0,
  published_at_unix         integer,
  continue_vote_close_unix  integer,
  UNIQUE (room_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_rounds_room_idx ON rounds (room_id, idx DESC);

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
  canonical_sha256    text        NOT NULL,
  signature_kind      text,
  signature_b64       text,
  signer_fingerprint  text,
  jwt_sub             text,
  client_nonce        text        NOT NULL,
  UNIQUE (round_id, author_id, client_nonce)
);

CREATE INDEX IF NOT EXISTS idx_submissions_nonce ON submissions (round_id, author_id, client_nonce);

CREATE INDEX IF NOT EXISTS idx_submissions_round_author ON submissions (round_id, author_id);

-- Votes: idempotent by (round_id, voter_id, kind, client_nonce)
CREATE TABLE IF NOT EXISTS votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id      uuid        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  voter_id      uuid        NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind          text        NOT NULL, -- e.g., 'continue'
  ballot        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_nonce  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, voter_id, kind, client_nonce)
);

CREATE INDEX IF NOT EXISTS idx_votes_room_round_kind ON votes (room_id, round_id, kind);

-- Future M1/M2: rooms/rounds tables, RLS policies, and RPCs
