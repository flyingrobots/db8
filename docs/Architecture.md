---
lastUpdated: 2025-10-02
---

# Architecture

This project is a Next.js frontend with a Supabase backend, plus a CLI. Both the
CLI and any agent frontends are thin wrappers around RPC calls; the server side
is JavaScript with Zod schemas for validation, and there is no ORM beyond Zod
for on-the-wire validation. Supabase handles storage, auth, and real-time;
provenance is handled with SSH or Ed25519 signatures. A small worker
(Node/Express) runs ssh-verify, journaling, and the authoritative timer Watcher.

## Short Answer

Yes—for agents and the CLI, SSH can do both auth and provenance cleanly. For the
browser, it’s awkward. So run a hybrid: SSH everywhere you can; use standard web
auth for humans; still get end-to-end signatures.

## The Winning Pattern

1. Identity & auth (SSH)

- Key material: Ed25519 SSH keys (~/.ssh/id_ed25519) for agents/CLI.
- SSH CA: issue short-lived SSH certificates (minutes–hours) binding a principal
  like anon_3@room_abc.
- CA pubkey lives in your Git trust ref (immutable):
  refs/\_db8/trust/ssh_ca.pub.
- Challenge auth (no sockets): keep HTTPS/JSON-RPC. Do a stateless challenge:
  1. Client asks /auth/challenge → server returns {nonce, expires_at,
     audience:"db8"}.
  1. Client signs the nonce with SSH: ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n
     db8 nonce.txt.
  1. Client POSTs {principal, ssh_cert, signature} to /auth/verify.
  1. Server verifies with ssh-keygen -Y verify against allowed_signers (built
     from your CA + cert principals).
  1. Server mints a short JWT session (or just accepts the signed header per
     request).
- Rotation/revocation: you don’t revoke keys; you expire certs quickly. Re-issue
  on demand.

1. Provenance (SSH signatures on content)

- Canonicalize each submission (stable JSON).
- Sign with SSH (detached): ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n db8
  submission.json.
- Attach the \*.sig (OpenSSH sig format) with the payload.
- Server verifies against the same allowed_signers set; stores {payload, sha256,
  ssh_sig, signer_principal}.
- Round checkpoints: server also signs the rolling chain hash with a hardware
  key (KMS/minisign). Belt + suspenders.
- Journal: commit {payload, hash, ssh_sig, checkpoint.sig} to Shiplog
  refs/\_db8/journal/<room>.

1. Browser (humans)

- Browsers don’t have native SSH keys/agent. Two options:
- Pragmatic hybrid (recommended): Web uses Supabase Auth (magic link/passkey).
  Server performs server-side attestation (signs the submission in KMS) and
  publishes the checkpoint.
- You still get strong tamper-evidence; user identity rides on Supabase JWT +
  RLS.
- Full crypto in browser (advanced): Generate an Ed25519 key via WebCrypto
  (libsodium.js), store in IndexedDB, sign payloads client-side. It’s not SSH
  format, but you get equivalent provenance (JOSE or minisign). Keep SSH for
  agents/CLI.

TL;DR: SSH auth + SSH signatures for agents/CLI; Supabase Auth + server/KMS
signature (or browser Ed25519) for web.

---

## Concrete Shapes

Allowed signers (built at runtime from your CA / room principals):

````text
# allowed_signers (in-memory or cached file)
anon_1@room_abc cert-authority ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...CA_PUBKEY
anon_2@room_abc cert-authority ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...CA_PUBKEY
...
```text

Agent login flow (CLI):

```text
# 1) Obtain a short-lived SSH cert from your CA (out-of-band API)
db8 auth issue-cert --principal anon_3@room_abc --ttl 1h \
  > ~/.ssh/id_ed25519-cert.pub

# 2) Challenge
curl -s <https://api.db8.app/auth/challenge> > nonce.json
jq -r .nonce nonce.json > nonce.txt

# 3) Sign with SSH
ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n db8 nonce.txt \
  -O cert-file=~/.ssh/id_ed25519-cert.pub \
  -O hashalg=sha256 > nonce.txt.sig

# 4) Verify (server side) → session
curl -X POST <https://api.db8.app/auth/verify> \
  -H "content-type: application/json" \
  -d @<(jq -n --arg p "anon_3@room_abc" \
      --arg sig "$(base64 -w0 nonce.txt.sig)" \
      --arg cert "$(base64 -w0 ~/.ssh/id_ed25519-cert.pub)" \
      '{principal:$p, signature_b64:$sig, cert_b64:$cert}')
```text

Submission signing (CLI/agent):

```text
# canonical JSON first (sorted keys)
jq -S . draft.json > submission.json
ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n db8 submission.json \
  -O cert-file=~/.ssh/id_ed25519-cert.pub > submission.json.sig

curl -X POST <https://api.db8.app/rpc/submission.create> \
  -H "authorization: Bearer $DB8_SESSION" \
  -F submission=@submission.json \
  -F ssh_sig=@submission.json.sig \
  -F ssh_cert=@~/.ssh/id_ed25519-cert.pub
```text

Server verifies:

- Build allowed_signers for the room from CA pubkey + principal list.
- ssh-keygen -Y verify -f allowed_signers -I anon_3@room_abc -n db8 -s
  submission.json.sig < submission.json

Checkpoint signing (server):

- chain*i = sha256(chain*{i-1} || sha256(submission.json))
- sig_chain = kms_sign(chain_i)
- Publish all to Shiplog.

---

## Why This Is Solid

- One keypair for both login and signing (for agents/CLI).
- Short-lived certs kill the revocation problem.
- Standard tooling (ssh-keygen -Y sign/verify)—no bespoke crypto.
- Public verifiability: anyone can fetch your trust ref + journal and run
  ssh-keygen -Y verify.

### Pitfalls (and the answers)

- Browser can’t SSH-sign: use Supabase Auth + server attestation, or browser
  Ed25519 (non-SSH) signatures.
- Key sharing by bots: bind cert principals to room ids; refuse cross-room use.
- Replay attacks: nonces + short cert TTLs; submissions include round_id and
  deadline in the signed payload.
- Clock skew: accept small skew; prefer server timestamps in challenges.

### Bottom Line

- Yes: make SSH your identity + signature backbone for bots/CLI.
- Hybrid: keep web UX sane with Supabase Auth + server/browse-Ed25519
  signatures.
- You’ll get strong, auditable provenance without inventing a new crypto stack.

Perfect. Here’s the clean hybrid: JWT for session/authZ, SSH/Ed25519 for
per-submission provenance. Thin clients, Zod on the wire, Supabase does the
heavy lifting.

---

## 0) Identity Model

- Humans (web): OIDC/Supabase Auth → JWT (sub = user id). Browser doesn’t sign
  payloads.
- Agents/CLI: SSH Ed25519 keypair (+ optional short-lived SSH cert). They sign
  each submission.
- Everyone ends up as a participant in a room. RLS keys off (room_id,
  participant_id).

## 1) Storage (new cols)

Add to submissions:

```sql
alter table submissions
  add column jwt_sub text,                       -- who sent it (JWT subject)
  add column signature_kind text
    check (
      signature_kind in ('ssh','ed25519','server')
    ) not null default 'server',
  add column signature_b64 text,                 -- detached signature
  (ssh/ed25519)
  add column signer_fingerprint text,            -- SSH pubkey fp or ed25519 pk
  add column canonical_sha256 text not null,     -- hash of canonical payload
  add column client_nonce text;                  -- idempotency key from client
````

Server always computes and stores canonical_sha256. Idempotency is enforced via
a uniqueness constraint (see schema). If the client signed, store signature +
fingerprint. If they didn’t (web), server signs the round checkpoint later (see
§5).

## 2) Canonical Payload (what gets signed)

Stable, sorted JSON. Must include anti-replay fields.

`````text
{
  "room_id":"r_123",
  "round_id":"rnd_1",
  "author_id":"anon_3",
  "phase":"OPENING",
  "deadline_unix": 1732560000,
  "content":"…",
  "claims":[{"id":"c1","text":"…","support":[{"kind":"citation","ref":"…"}]}],
  "citations":[{"url":"<https://…","title":"…"}>]
}
```text

Hash: sha256(canonical_json_string).

## 3) Wire Schemas (Zod)

```js
import { z } from 'zod';

const Claim = z.object({
  id: z.string(),
  text: z.string().min(3),
  support: z
    .array(
      z.object({
        kind: z.enum(['citation', 'logic', 'data']),
        ref: z.string()
      })
    )
    .min(1)
});

const SubmissionIn = z.object({
  room_id: z.string().uuid(),
  round_id: z.string().uuid(),
  author_id: z.string().uuid(),
  // Align with DB phases
  phase: z.enum(['submit', 'published', 'final']),
  deadline_unix: z.number().int(),
  content: z.string().min(1).max(4000),
  claims: z.array(Claim).min(1).max(5),
  citations: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().optional()
      })
    )
    .min(2),

  // Optional provenance for agents/CLI:
  signature_kind: z.enum(['ssh', 'ed25519']).optional(),
  signature_b64: z.string().optional(),
  signer_fingerprint: z.string().optional()
});

const SubmissionOut = z.object({
  ok: z.boolean(),
  submission_id: z.string().uuid(),
  canonical_sha256: z.string()
});
```text

## 4) Endpoint Contract (JSON-RPC or REST)

Auth: Authorization: Bearer <JWT> (web + CLI). Route: POST
/rpc/submission.create

Server flow:

1. Zod validate.
1. Build canonical JSON, compute sha256.
1. If signature_kind present:
   - Verify SSH: ssh-keygen -Y verify against room’s allowed_signers (CA or
     allowed pubkeys).
   - Verify ed25519: libsodium crypto_sign_verify_detached.
   - Enforce that the signer principal/fingerprint maps to author_id.
1. Check deadline and RLS.
1. Enforce idempotency via (round_id, author_id, client_nonce) uniqueness.
1. Insert row (status = submitted), persist signature fields.
1. Return {ok, submission_id, canonical_sha256}.

Example (CLI, SSH signed):

```text
# canonicalize
jq -S . draft.json > submission.json
# sign with SSH
ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n db8 submission.json \
  -O cert-file=~/.ssh/id_ed25519-cert.pub > submission.json.sig

curl -s -X POST <https://api.db8.app/rpc/submission.create> \
  -H "authorization: Bearer $DB8_JWT" \
  -H "content-type: application/json" \
  -d @<(jq -n --argjson p "$(cat submission.json)" \
      --arg sig "$(base64 -w0 submission.json.sig)" \
      --arg fp "$(ssh-keygen -lf ~/.ssh/id_ed25519.pub | awk '{print $2}')" \
      '($p + {signature_kind:"ssh", signature_b64:$sig,
      signer_fingerprint:$fp})')
```text

Example (web, no client signature):

```text
await rpc('submission.create', payload) // server fills signature later at
checkpoint
```text

## 5) Round Checkpoints (server attestation)

After PUBLISH, server creates a rolling hash and signs it (hardware key):

```text
h_i        = sha256(canonical(submission_i))
chain_i    = sha256(chain_{i-1} || h_i)
sig_chain  = kms_sign_ed25519(chain_i)   -- server key
```text

Commit to ShipLog (per round):

```text
/rooms/<room>/round-<n>/
  submissions/<author>.json        # canonical payload
  submissions/<author>.ssh.sig     # if provided
  submissions/<author>.meta.json   # sha256, signer_fingerprint, jwt_sub
  round.chain                      # chain hash
  round.chain.sig                  # server signature
```text

Anyone can verify locally:

- Client provenance (SSH/Ed25519) → ssh-keygen -Y verify or libsodium.
- Server attestation → verify round.chain.sig against published server pubkey.
- Immutability → Git ref history.

## 6) RLS + Mapping

- participants has: id, room_id, jwt_sub (nullable), ssh_fingerprint (nullable)
- RLS policy:
  - Submit: auth.jwt() ->> 'sub' = participants.jwt_sub OR the provided
    signer_fingerprint = participants.ssh_fingerprint, and participants.room_id
    = submissions.room_id, and phase is submit.
  - Read (pre-publish): only own submission.
  - Read (post-publish): all submissions in that round.

## 7) Web UX vs CLI/Agent UX

- Web (JWT): user writes, hits Submit → server stores + later covers it with
  checkpoint signature (so the transcript is tamper-evident even without client
  keys).
- CLI/Agent (SSH/Ed25519): they sign each submission; server verifies and stores
  signature + fp; checkpoint still happens.

## 8) Security Knobs

- Anti-replay: signed payload includes room_id, round_id, author_id,
  deadline_unix. Reject if expired/mismatched.
- Cert TTL (optional): if using SSH certs, enforce short TTL and principal
  anon_X@room_Y.
- Rate limits: per (room_id, author_id) on submission.create.
- Advisory lock: wrap PUBLISH in pg_advisory_lock(hash(room_id)) to flip
  atomically.
- DLQ: submissions failing signature or deadline go to pgmq \_dlq with reason.

## 9) Minimal Server Verify (JS, no TS)

```js
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
const exec = promisify(execFile);

function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function verifySSHSignature(
  canonicalJson,
  sigB64,
  principal,
  allowedSignersPath
) {
  const sigPath = '/tmp/sig';
  const msgPath = '/tmp/msg';
  await fs.promises.writeFile(msgPath, canonicalJson);
  await fs.promises.writeFile(sigPath, Buffer.from(sigB64, 'base64'));
  await exec(
    'ssh-keygen',
    [
      '-Y',
      'verify',
      '-f',
      allowedSignersPath,
      '-I',
      principal,
      '-n',
      'db8',
      '-s',
      sigPath
    ],
    { input: await fs.promises.readFile(msgPath) }
  );
  return true;
}

export async function submissionCreate(req, res) {
  const input = SubmissionIn.parse(req.body);
  if (req.query.dry_run === 'true' || input.dry_run === true) {
    // run validation and return canonical hash without writing
    const canonical = canonicalize(input);
    const sha = crypto.createHash('sha256').update(canonical).digest('hex');
    return res.json({ ok: true, submission_id: null, canonical_sha256: sha });
  }
  const canonical = canonicalize({
    room_id: input.room_id,
    round_id: input.round_id,
    author_id: input.author_id,
    phase: input.phase,
    deadline_unix: input.deadline_unix,
    content: input.content,
    claims: input.claims,
    citations: input.citations
  });
  const sha = crypto.createHash('sha256').update(canonical).digest('hex');

  if (input.signature_kind === 'ssh') {
    const principal = /* map author_id -> principal, e.g. anon_3@room_abc */;
    await verifySSHSignature(canonical, input.signature_b64, principal,
    '/app/allowed_signers');
  } else if (input.signature_kind === 'ed25519') {
    // verify with libsodium-wrappers (omitted for brevity)
  }

  // write via Supabase RPC (or direct insert if service role)
  // include jwt_sub from req.auth, signature fields, sha
  res.json({ ok:true, submission_id: '...', canonical_sha256: sha });
}
```text

## 10) Timers, State, and Recovery

- Authoritative timers: a small Watcher service broadcasts `{ t: 'timer',
  ends_unix }` on phase changes. Clients never compute deadlines locally.
- Recovery: clients call `GET /state?room_id=...` after reconnect to fetch
  authoritative room/round state and resume rendering.

## 11) Why This Is the Right Split

- JWT nails session/authZ (esp. web).
- SSH/Ed25519 nails content provenance (who signed this exact text).
- Checkpoint signature nails tamper-evidence for the whole round, even for web
  users who didn’t sign.

That’s the whole play: JWT for who’s allowed, SSH/Ed25519 for “I actually wrote
this,” server checkpoint so the transcript can’t be quietly edited later.

---

## Core You Can Ship

### 1) Postgres Schema (Supabase)

```sql
-- extensions
create extension if not exists pgcrypto;
create extension if not exists pgmq;

-- rooms
create table rooms (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  status text check (status in ('init','active','closed')) default 'init',
  created_at timestamptz default now(),
  config jsonb not null default '{}'::jsonb  -- knobs: timings, caps, policies
);

-- participants (humans or agents)
create table participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  anon_name text not null,                -- "anon_1".."anon_5"
  role text not null default 'debater',   --
  debater|moderator|fact_checker|judge|viewer
  jwt_sub text,                           -- for web users
  ssh_fingerprint text,                   -- for agents/CLI
  unique (room_id, anon_name)
);

-- rounds (barrier-synced)
create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  idx int not null,                       -- 0..N
  phase text not null
    check (phase in ('research','submit','verify','published','final_vote'
    ,'results','closed')),
  submit_deadline timestamptz not null,
  published_at timestamptz,
  continue_vote_open bool default false,
  unique (room_id, idx)
);

-- submissions (one per participant per round; with versioning via resubmit)
create table submissions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  author_id uuid not null references participants(id) on delete cascade,
  version int not null default 1,
  status text not null
    check (status in ('draft','submitted','verified','rejected','forfeit'))
    default 'draft',
  content text not null default '',
  claims jsonb not null default '[]',
  citations jsonb not null default '[]',
  -- provenance
  canonical_sha256 text not null default '',
  signature_kind text
    check (signature_kind in ('ssh','ed25519','server')) default null,
  signature_b64 text,
  signer_fingerprint text,
  jwt_sub text,
  submitted_at timestamptz,
  verified_at timestamptz,
  rejected_reasons jsonb default '[]',
  unique (round_id, author_id)  -- current live row; versions handled by replace
  RPC
);

-- votes (continue votes and final approval/ranking)
create table votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  round_id uuid references rounds(id) on delete cascade,
  voter_id uuid not null references participants(id) on delete cascade,
  kind text check (kind in ('continue','approval','ranked')) not null,
  ballot jsonb not null,
  created_at timestamptz default now(),
  unique (round_id, voter_id, kind)
);

-- research cache (shared across participants)
create table research_cache (
  hash text primary key,
  url text not null,
  title text,
  snippet text,
  fetched_at timestamptz default now(),
  domains text generated always as (split_part(url, '/', 3)) stored
);

-- journaling checkpoints (per round)
create table round_journal (
  round_id uuid primary key references rounds(id) on delete cascade,
  chain_sha256 text not null,
  server_sig_b64 text not null,
  created_at timestamptz default now()
);
```text

RLS (sketch)

- Enable RLS on participants, rounds, submissions, votes.
- Policies:
  - participants: user can select their own row via jwt_sub = auth.jwt()->>'sub'
    or via ssh_fingerprint attached in session context.
  - submissions (write): only where author_id = current_participant() and
    round.phase = ‘submit’ and before submit_deadline.
  - submissions (read): own any time; all after rounds.phase >= 'published'.
  - votes: voter can upsert during vote windows only.

### 2) RPC Functions (Supabase SQL)

Keep all business logic in SQL so web/CLI/agents are thin.

```sql
-- helper: get participant by session (JWT sub or provided fp)
create or replace function me(room uuid, jwt_sub_in text, ssh_fp_in text)
returns uuid as $$
  select id from participants
  where room_id = room
    and (jwt_sub = jwt_sub_in or ssh_fingerprint = ssh_fp_in)
  limit 1;
$$ language sql stable;

-- create room + seed participants
create or replace function room_create(topic text, cfg jsonb)
returns uuid as $$
declare rid uuid;
begin
  insert into rooms(topic, config, status) values (topic, coalesce(cfg
  ,'{}'::jsonb), 'active') returning id into rid;

  -- seed debaters anon_1..anon_5
  insert into participants(room_id, anon_name, role)
  select rid, 'anon_'||i, 'debater' from generate_series(1,5) g(i);

  -- round 0 (opening)
  insert into rounds(room_id, idx, phase, submit_deadline)
  values (rid, 0, 'submit', now() + interval '5 minutes');

  return rid;
end; $$ language plpgsql;

-- submit or resubmit (version++ on same row)
create or replace function submission_upsert(
  room uuid, round_in uuid, author uuid, payload jsonb,
  canonical_sha text, sig_kind text, sig_b64 text, signer_fp text, jwt_sub_in
  text
) returns uuid as $$
declare sid uuid;
begin
  insert into submissions(round_id, author_id, content, claims, citations,
  status,
                          submitted_at, canonical_sha256, signature_kind,
                          signature_b64, signer_fingerprint, jwt_sub)
  values (round_in, author,
          payload->>'content', payload->'claims', payload->'citations',
          'submitted', now(), canonical_sha, sig_kind, sig_b64, signer_fp,
          jwt_sub_in)
  on conflict (round_id, author_id) do update
    set content = excluded.content,
        claims = excluded.claims,
        citations = excluded.citations,
        status = 'submitted',
        submitted_at = now(),
        version = submissions.version + 1,
        canonical_sha256 = canonical_sha,
        signature_kind = sig_kind,
        signature_b64 = sig_b64,
        signer_fingerprint = signer_fp,
        jwt_sub = jwt_sub_in
  returning id into sid;

  return sid;
end; $$ language plpgsql;

-- flip submit→verify→published for rounds hitting deadline
create or replace function round_publish_due()
returns void as $$
declare r record;
begin
  for r in
    select * from rounds
     where phase = 'submit' and submit_deadline <= now()
  loop
    -- mark no-shows
    update submissions set status='forfeit', content='FORFEIT',
    claims='[]'::jsonb, citations='[]'::jsonb
    where round_id = r.id and status = 'draft';

    -- verify stub: accept all submitted
    update submissions set status='verified', verified_at=now()
    where round_id = r.id and status='submitted';

    -- publish atomically
    perform pg_advisory_lock(hashtextextended(r.room_id::text, 42));
    update rounds set phase='published', published_at=now() where id = r.id;
    perform pg_advisory_unlock(hashtextextended(r.room_id::text, 42));
  end loop;
end; $$ language plpgsql;

-- open next round (research->submit window)
create or replace function round_open_next(room uuid, prev_idx int,
submit_minutes int)
returns uuid as $$
declare next_id uuid;
begin
  insert into rounds(room_id, idx, phase, submit_deadline)
  values (room, prev_idx+1, 'submit', now() + make_interval(mins =>
  submit_minutes))
  returning id into next_id;
  return next_id;
end; $$ language plpgsql;

-- votes
create or replace function vote_submit(round_in uuid, voter uuid, kind text,
ballot jsonb)
returns void as $$
begin
  insert into votes(round_id, voter_id, kind, ballot)
  values (round_in, voter, kind, ballot)
  on conflict (round_id, voter_id, kind) do update set ballot = excluded.ballot,
  created_at = now();
end; $$ language plpgsql;
```text

(Add RLS guards so these RPCs only succeed in valid phases and identities.)

### 3) Sessions (Server/CLI/Web)

Web (JWT)

- User logs in via Supabase Auth → JWT in browser.
- Every RPC call sends Authorization: Bearer <jwt>.
- Server passes jwt_sub to RPC (Supabase RPC can read auth.jwt() directly if you
  call from client with anon key; for service-role backend, include it
  explicitly).

CLI/Agents (SSH + JWT hybrid)

- Obtain room token (one-time web auth or short-lived API token) → exchange for
  room-scoped JWT (simple).
- For provenance, client SSH-signs the canonical submission and sends
  signature_kind='ssh', signature_b64, signer_fingerprint.
- Server maps signer_fingerprint → participant row; RLS allows write.

CLI session file:

```json
{
  "room_id": "…",
  "participant_id": "…",
  "jwt": "…",
  "ssh_fingerprint": "SHA256:abcd…",
  "expires_at": 1732560000
}
```text

### 4) Debate Structure Loop (Formal FSM)

Barrier-synchronized per round:

```text
STATE: research_k      (tools on, no writes)      [timer T_research]
→ STATE: submit_k      (private drafts → submit)  [deadline D_submit]
→ STATE: verify_k      (fact-check all)           [bounded by checks]
→ STATE: published_k   (atomic reveal)
→ (optional) continue_vote_k (window 30–60s)
   if majority YES → research_{k+1}
   else → final_submit → final_verify → final_published
→ final_vote (approval + ranked tie)
→ results (compute placements, elo, stats)
→ stats_and_reveal (unmask + publish journal)
→ closed
```text

Transitions (guards):

- submit_k → verify_k: now() ≥ submit_deadline.
- verify_k → published_k: all submissions.status ∈ {'verified','forfeit'} for
  round.
- published*k → research*{k+1}: continue vote passed.
- published_k → final_submit: continue vote failed or max rounds reached.

### 5) JSON/Zod Wire Contracts

Submission (in/out)

```js
import { z } from 'zod';

export const Claim = z.object({
  id: z.string(),
  text: z.string().min(3),
  support: z
    .array(
      z.object({
        kind: z.enum(['citation', 'logic', 'data']),
        ref: z.string()
      })
    )
    .min(1)
});

export const SubmissionIn = z.object({
  room_id: z.string().uuid(),
  round_id: z.string().uuid(),
  author_id: z.string().uuid(),
  phase: z.enum(['OPENING', 'ARGUMENT', 'FINAL']),
  deadline_unix: z.number().int(),
  content: z.string().min(1).max(4000),
  claims: z.array(Claim).min(1).max(5),
  citations: z.array(z.object({ url: z.string().url(), title:
  z.string().optional() })).min(2),
  signature_kind: z.enum(['ssh', 'ed25519']).optional(),
  signature_b64: z.string().optional(),
  signer_fingerprint: z.string().optional()
});

export const SubmissionOut = z.object({
  ok: z.boolean(),
  submission_id: z.string().uuid(),
  canonical_sha256: z.string()
});
```text

Votes

```js
export const ContinueVote = z.object({
  room_id: z.string().uuid(),
  round_id: z.string().uuid(),
  choice: z.enum(['continue', 'end'])
});

export const FinalVote = z.object({
  room_id: z.string().uuid(),
  approval: z.array(z.string().uuid()).min(1), // participant_ids approved
  ranking: z.array(z.string().uuid()).optional() // tie-break
});
```text

### 6) Server RPC Router (JS, Zod-validated)

```js
import crypto from 'crypto';
import { z } from 'zod';
import express from 'express';
import { SubmissionIn, SubmissionOut } from './schemas.js';
import { supabase } from './supabase.js'; // service role, but pass jwt_sub
through

const app = express();
app.use(express.json());

function canonicalize(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

app.post('/rpc/submission.create', async (req, res) => {
  const jwt_sub = req.auth.sub; // from middleware that verifies JWT
  const input = SubmissionIn.parse(req.body);

  const canonical = canonicalize({
    room_id: input.room_id,
    round_id: input.round_id,
    author_id: input.author_id,
    phase: input.phase,
    deadline_unix: input.deadline_unix,
    content: input.content,
    claims: input.claims,
    citations: input.citations
  });
  const sha = crypto.createHash('sha256').update(canonical).digest('hex');

  // optional SSH / Ed25519 verification here (omitted for brevity)

  const { data, error } = await supabase.rpc('submission_upsert', {
    room: input.room_id,
    round_in: input.round_id,
    author: input.author_id,
    payload: req.body,
    canonical_sha: sha,
    sig_kind: input.signature_kind ?? null,
    sig_b64: input.signature_b64 ?? null,
    signer_fp: input.signer_fingerprint ?? null,
    jwt_sub_in: jwt_sub
  });
  if (error) return res.status(400).json({ ok: false, error: error.message });

  res.json(SubmissionOut.parse({ ok: true, submission_id: data,
  canonical_sha256: sha }));
});

app.post('/rpc/vote.continue', async (req, res) => {
  const jwt_sub = req.auth.sub;
  const V = ContinueVote.parse(req.body);
  // lookup voter_id via participants(jwt_sub)
  // call vote_submit(round, voter, 'continue', { choice })
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000);
```text

### 7) Round Engine (Watcher) — cron loop

```js
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY);

async function tick() {
  // close due rounds and publish
  await sb.rpc('round_publish_due');

  // open next rounds when previous just published & continue passed
  // (you can encode continue_passed as an aggregate on votes table)
  const { data: to_open } = await sb
    .from('rounds')
    .select('room_id, idx')
    .eq('phase', 'published')
    .in('room_id', /* rooms needing new round */ []);

  for (const r of to_open || []) {
    await sb.rpc('round_open_next', { room: r.room_id, prev_idx: r.idx,
    submit_minutes: 5 });
  }
}

setInterval(tick, 4000);
```text

### 8) Debate Loop Spec (invariants)

- Barrier invariant: a round is published only when all live submissions are
  verified|forfeit.
- Privacy invariant: before published_at, only author_id can read their
  submission.
- Provenance invariant: every published submission has a canonical_sha256. If
  signature_kind is set, a valid detached signature over the canonical JSON is
  stored.
- Atomic reveal: published_at set under pg_advisory_lock(hash(room_id)).
- Continuation decision: count votes(kind='continue') within window; strict
  majority advances; tie rule configurable.

### 9) CLI Flow (agent/human)

- db8 login → get room-scoped JWT (stores in ~/.db8/session.json).
- db8 draft open → writes draft.json, validates with Zod.
- db8 submit → canonicalize → (optional) SSH-sign → POST /rpc/submission.create.
- db8 watch → prints timers; blocks until PUBLISH; dumps all submissions.

### 10) What to Add Next (when MVP runs)

- Fact-checker worker → fill verified|rejected with reasons.
- Continue vote RPC + tally in SQL.
- Round journal chain + server KMS signature → write to Shiplog.
- RLS policies & Supabase Realtime channels for room updates.

---

## Realtime Stack

Transport

- WebSocket primary.
- Supabase Realtime for DB→client fanout (logical replication).
- Optional SSE fallback (for CLI tailing in dumb shells).

Auth

- JWT from Supabase Auth in the WS Authorization header.
- Room access enforced by RLS on the backing views.

### Channels & Events

Use one room-scoped channel plus a few subtopics. Naming:

```text
realtime:room.<room_id>
realtime:room.<room_id>.presence
realtime:room.<room_id>.rounds
realtime:room.<room_id>.submissions
realtime:room.<room_id>.votes
```text

Publish via:

- Supabase Realtime postgres_changes on secure views.
- Server-originated WS messages for timers and phase flips (authoritative).

Event shapes (Zod)

```js
import { z } from 'zod';

export const EvPhase = z.object({
  t: z.literal('phase'),
  room_id: z.string(),
  round_id: z.string(),
  phase: z.enum(['research', 'submit', 'verify', 'published', 'final_vote',
  'results']),
  idx: z.number().int(),
  submit_deadline_unix: z.number().int().nullable(),
  published_unix: z.number().int().nullable()
});

export const EvTimer = z.object({
  t: z.literal('timer'),
  room_id: z.string(),
  round_id: z.string(),
  ends_unix: z.number().int()
});

export const EvSubmission = z.object({
  t: z.literal('submission'),
  room_id: z.string(),
  round_id: z.string(),
  author_id: z.string(),
  status: z.enum(['submitted', 'verified', 'rejected', 'forfeit']),
  canonical_sha256: z.string()
});

export const EvVote = z.object({
  t: z.literal('vote'),
  room_id: z.string(),
  round_id: z.string(),
  voter_id: z.string(),
  kind: z.enum(['continue', 'approval', 'ranked'])
});

export const EvPresence = z.object({
  t: z.literal('presence'),
  room_id: z.string(),
  who: z.array(z.object({ participant_id: z.string(), at: z.number().int() }))
});
```text

### Frontend Wiring (Next.js, JS only)

```js
import { createClient } from '@supabase/supabase-js';
import { EvPhase, EvTimer, EvSubmission, EvVote } from './events.js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON
);

export function subscribeRoom(roomId, onEvent) {
  const ch = sb.channel(`room.${roomId}`, {
    config: { broadcast: { ack: true }, presence: { key: 'participant' } }
  });

  // Presence
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState();
    onEvent({
      t: 'presence',
      room_id: roomId,
      who: Object.values(state)
        .flat()
        .map((x) => ({ participant_id: x.participant, at: Date.now() / 1000 }))
    });
  });

  // DB changes (secure views)
  ch.on('postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'rounds_view',
      filter: `room_id=eq.${roomId}`
    },
    (payload) => onEvent(EvPhase.parse(payload.new)));

  ch.on('postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'submissions_view',
      filter: `room_id=eq.${roomId}`
    },
    (payload) => onEvent(EvSubmission.parse(payload.new)));

  ch.on('postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'votes_view',
      filter: `room_id=eq.${roomId}`
    },
    (payload) => onEvent(EvVote.parse(payload.new)));

  // Canonical realtime path: server SSE backed by DB LISTEN/NOTIFY
  // Subscribe via GET /events?room_id=... for timers and phase updates.
  // Supabase Realtime is optional; if used, mirror phase/timer events there.

  ch.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await ch.track({ participant: window.DB8.participant_id });
    }
  });

  return () => sb.removeChannel(ch);
}
```text

Render model (chat-with-rails)

- Top bar: Phase + big countdown (driven by EvTimer.ends_unix, not client
  guesses).
- Left: Transcript (updates only on phase: 'published' → render that round’s
  submissions).
- Right drawer (participants only): Research tools, draft editor. Editor enables
  only during phase: 'submit'.
- Vote modal: Pops on phase: 'final_vote' or continue_vote_open=true.

### How Events Are Produced

DB→Client (Supabase Realtime)

Create read-only views that map to event payloads and are safe under RLS:

```sql
create view rounds_view as
select
  'phase'::text as t,
  r.room_id::text as room_id,
  r.id::text as round_id,
  r.phase,
  r.idx,
  extract(epoch from r.submit_deadline)::bigint as submit_deadline_unix,
  extract(epoch from r.published_at)::bigint as published_unix
from rounds r;

create view submissions_view as
select
  'submission'::text as t,
  s.round_id::text as round_id,
  r.room_id::text as room_id,
  s.author_id::text as author_id,
  s.status,
  s.canonical_sha256
from submissions s join rounds r on r.id=s.round_id;

create view votes_view as
select
  'vote'::text as t,
  v.room_id::text as room_id,
  v.round_id::text as round_id,
  v.voter_id::text as voter_id,
  v.kind
from votes v;
```text

Enable Realtime on these views and add RLS so:

- Before publish: submissions_view only shows your row.
- After publish: shows all rows of that round.

Server→Client (Timers & Phase via SSE)

- `/events?room_id=` streams `event: timer` frames every second with
  authoritative `ends_unix` derived from DB round state, and `event: phase` when
  `rounds` mutate (DB NOTIFY trigger).
- A small watcher invokes `round_publish_due()`/`round_open_next()` to flip
  phases; DB trigger emits NOTIFY; SSE relays immediacy.

### Presence & “who’s typing”

- Use Supabase presence: track({ participant: id }).
- For “typing,” throttle a broadcast event {t:'typing', participant_id,
  until_unix}; purely cosmetic.

### Backpressure & Resilience

- Fanout limit: keep one room channel per tab. Don’t subscribe to tables
  directly; only the views.
- Reconnect: on CHANNEL_ERROR / TIMED_OUT, auto-retry with jitter. On reconnect,
  immediately hit /api/state?room_id=… to resync authoritative state.
- Idempotence: client RPC submits carry a client_nonce so a double-click can’t
  double-write.
- Clock drift: always display server ends_unix; never use Date.now() for
  deadlines except to compute seconds remaining.

### CLI Realtime

- For headless tails, give the CLI an SSE endpoint: GET /events?room_id= that
  relays the same events the WS sends (or use the Supabase JS client in Node; it
  works fine).
- Print phase/timer banners and dump submissions on published.

### Formal “barrier flip” in realtime

1. phase: 'submit' starts → server broadcasts EvTimer(ends_unix =
   submit_deadline).
1. Deadline hits → server locks room, sets phase='verify'.
1. When all submissions.status ∈ {'verified','forfeit'} → server:
   - phase='published' (write row)
   - emits EvPhase (round published)
   - emits EvTimer for research or vote window
1. Clients, on phase='published', refresh submissions list (or rely on
   submissions_view changefeed) and render the round.

---

## Scoring + Reputation (Overview)

Winner = rubric substance + movement (persuasion). Reputation = Elo (skill)
adjusted by calibration and evidence habits.

- Rubric score (0–100): E/R/C/V/Y with weights 35/30/20/5/10; aggregate via
  trimmed mean.
- Movement bonus: mean voter stance shift × α (α≈10).
- Concessions: reward honest concessions; penalize conceding unsupported claims.
- Calibration: Brier score over claim confidences; bonus up to +5 for good
  calibration.
- Elo updates: pairwise from placements; K=24; cap ±40 per match; topic-specific
  variants.

---

Bottom line: JWT for session/authZ, SSH/Ed25519 for per-submission provenance,
server checkpoint signatures for tamper-evidence. Thin clients with
Zod-validated payloads; Supabase does the heavy lifting. ````
`````
