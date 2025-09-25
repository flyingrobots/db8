-- db/rpc.sql (placeholders for M1)

-- room_create(topic, cfg) → uuid
create or replace function room_create(topic text, cfg jsonb)
returns uuid as $$
declare rid uuid;
begin
  insert into rooms(topic, config, status) values (topic, coalesce(cfg,'{}'::jsonb), 'active') returning id into rid;
  insert into participants(room_id, anon_name, role)
  select rid, 'anon_'||i, 'debater' from generate_series(1,5) g(i);
  insert into rounds(room_id, idx, phase, submit_deadline)
  values (rid, 0, 'submit', now() + interval '5 minutes');
  return rid;
end; $$ language plpgsql;

-- round_publish_due() – accept-all verify stub → publish
create or replace function round_publish_due()
returns void as $$
declare r record;
begin
  for r in select * from rounds where phase = 'submit' and submit_deadline <= now() loop
    update submissions set status='forfeit', content='FORFEIT', claims='[]'::jsonb, citations='[]'::jsonb
      where round_id = r.id and status = 'draft';
    update submissions set status='verified', verified_at=now()
      where round_id = r.id and status='submitted';
    perform pg_advisory_lock(hashtextextended(r.room_id::text, 42));
    update rounds set phase='published', published_at=now() where id = r.id;
    perform pg_advisory_unlock(hashtextextended(r.room_id::text, 42));
  end loop;
end; $$ language plpgsql;

-- round_open_next(room, prev_idx, submit_minutes) → uuid
create or replace function round_open_next(room uuid, prev_idx int, submit_minutes int)
returns uuid as $$
declare next_id uuid;
begin
  insert into rounds(room_id, idx, phase, submit_deadline)
  values (room, prev_idx+1, 'submit', now() + make_interval(mins => submit_minutes))
  returning id into next_id;
  return next_id;
end; $$ language plpgsql;

