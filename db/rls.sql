-- db/rls.sql (skeleton)

alter table if exists rooms enable row level security;
alter table if exists participants enable row level security;
alter table if exists rounds enable row level security;
alter table if exists submissions enable row level security;
alter table if exists votes enable row level security;

-- NOTE: For M1 writes occur via service role RPC in server. Reads use views above with policies below.

-- Example policy sketches (to be refined):
-- View-only access will be granted via API roles; base tables remain locked down.

