-- db/rls.sql — RLS policies (M1 minimal)

alter table if exists rooms enable row level security;
alter table if exists participants enable row level security;
alter table if exists rounds enable row level security;
alter table if exists submissions enable row level security;
alter table if exists votes enable row level security;
alter table if exists submission_flags enable row level security;

-- Helper: current participant id from session (set via set_config('db8.participant_id', uuid, false))
create or replace function db8_current_participant_id()
returns uuid language sql stable as $$
  select nullif(current_setting('db8.participant_id', true), '')::uuid
$$;

-- Minimal read policy on submissions:
--  - During 'submit': only the author can read their own row
--  - After 'published': anyone can read (researchers, spectators); fine-grained room scoping can arrive later
drop policy if exists submissions_read_policy on submissions;
create policy submissions_read_policy on submissions
for select
using (
  (
    exists (
      select 1 from rounds r where r.id = submissions.round_id and r.phase = 'published'
    )
  )
  or
  submissions.author_id = db8_current_participant_id()
);

-- Deny writes by default (writes occur via service-role RPCs)
drop policy if exists submissions_no_write_policy on submissions;
create policy submissions_no_write_policy on submissions
for all to public
using (false)
with check (false);

-- Read-only policies for rooms, participants, rounds, votes (M1 minimal): allow SELECT to public
drop policy if exists rooms_read_policy on rooms;
create policy rooms_read_policy on rooms for select using (true);

drop policy if exists participants_read_policy on participants;
create policy participants_read_policy on participants for select using (true);

drop policy if exists rounds_read_policy on rounds;
create policy rounds_read_policy on rounds for select using (true);

drop policy if exists votes_read_policy on votes;
create policy votes_read_policy on votes for select using (true);

-- Flags: allow read only after publish to avoid pre-publish leakage
drop policy if exists submission_flags_read_policy on submission_flags;
create policy submission_flags_read_policy on submission_flags
for select
using (
  exists (
    select 1
      from submissions s
      join rounds r on r.id = s.round_id
     where s.id = submission_flags.submission_id
       and r.phase = 'published'
  )
);

-- Performance note: submissions_read_policy references rounds(id, phase).
-- Ensure an index exists on rounds to support this predicate. Consider materializing
-- round phase on submissions or exposing read via a view for larger datasets.
