-- db/rls.sql — RLS policies (M1 minimal)

alter table if exists rooms enable row level security;
alter table if exists participants enable row level security;
alter table if exists rounds enable row level security;
alter table if exists submissions enable row level security;
alter table if exists votes enable row level security;

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
