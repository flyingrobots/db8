-- db/schema.sql (M1 skeleton)
create extension if not exists pgcrypto;

-- Rooms
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  tags text[] default '{}'::text[],
  status text check (status in ('init','active','closed')) default 'init',
  created_at timestamptz default now(),
  config jsonb not null default '{}'::jsonb
);

-- Participants
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  anon_name text not null,
  role text not null default 'debater',
  role_flags jsonb not null default '{}'::jsonb,
  jwt_sub text,
  ssh_fingerprint text,
  unique (room_id, anon_name)
);

-- Rounds
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  idx int not null,
  phase text not null check (phase in ('research','submit','verify','published','final_vote','results','closed')),
  submit_deadline timestamptz not null,
  vote_until timestamptz,
  published_at timestamptz,
  unique (room_id, idx)
);

-- Submissions
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  author_id uuid not null references participants(id) on delete cascade,
  version int not null default 1,
  status text not null check (status in ('draft','submitted','verified','rejected','forfeit')) default 'draft',
  content text not null default '',
  claims jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  canonical_sha256 text not null default '',
  signature_kind text check (signature_kind in ('ssh','ed25519','server')),
  signature_b64 text,
  signer_fingerprint text,
  jwt_sub text,
  client_nonce text,
  submitted_at timestamptz,
  verified_at timestamptz,
  rejected_reasons jsonb default '[]'::jsonb,
  unique (round_id, author_id, client_nonce)
);

-- Votes
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_id uuid references rounds(id) on delete cascade,
  voter_id uuid not null references participants(id) on delete cascade,
  kind text check (kind in ('continue','approval','ranked')) not null,
  ballot jsonb not null,
  client_nonce text,
  received_at timestamptz default now(),
  unique (round_id, voter_id, kind, client_nonce)
);

-- Views (RLS-safe projection, policies added in rls.sql)
create or replace view rounds_view as
select
  'phase'::text as t,
  r.room_id::text as room_id,
  r.id::text as round_id,
  r.phase,
  r.idx,
  extract(epoch from r.submit_deadline)::bigint as submit_deadline_unix,
  extract(epoch from r.published_at)::bigint as published_unix
from rounds r;

create or replace view submissions_view as
select
  'submission'::text as t,
  s.round_id::text as round_id,
  r.room_id::text as room_id,
  s.author_id::text as author_id,
  s.status,
  s.canonical_sha256
from submissions s join rounds r on r.id = s.round_id;

create or replace view votes_view as
select
  'vote'::text as t,
  v.room_id::text as room_id,
  v.round_id::text as round_id,
  v.voter_id::text as voter_id,
  v.kind
from votes v;

