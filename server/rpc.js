import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { rateLimitStub } from './mw/rate-limit.js';
import { SubmissionIn, ContinueVote } from './schemas.js';
import { canonicalize, sha256Hex } from './utils.js';

const app = express();
app.use(express.json());
app.use(rateLimitStub({ enforce: process.env.ENFORCE_RATELIMIT === '1' }));
// Serve static demo files (public/*) so you can preview UI in a browser
app.use(express.static('public'));

// Optional DB client (if DATABASE_URL provided)
let db = null;
if (process.env.DATABASE_URL) {
  try {
    db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  } catch {
    db = null;
  }
}

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory idempotency and submission store (M1 stub / fallback)
const memSubmissions = new Map(); // key -> { id, canonical_sha256 }

// submission.create
app.post('/rpc/submission.create', (req, res) => {
  try {
    const input = SubmissionIn.parse(req.body);
    const canon = canonicalize({
      room_id: input.room_id,
      round_id: input.round_id,
      author_id: input.author_id,
      phase: input.phase,
      deadline_unix: input.deadline_unix,
      content: input.content,
      claims: input.claims,
      citations: input.citations,
      client_nonce: input.client_nonce
    });
    const canonical_sha256 = sha256Hex(canon);
    // Enforce deadline if provided (> 0)
    const now = Math.floor(Date.now() / 1000);
    if (input.deadline_unix && input.deadline_unix > 0 && now > input.deadline_unix) {
      return res.status(400).json({ ok: false, error: 'deadline_passed' });
    }

    const key = `${input.room_id}:${input.round_id}:${input.author_id}:${input.client_nonce}`;
    if (db) {
      // Try to persist and respect idempotency at DB level when possible
      // Note: schema unique keys may not exist yet; use an upsert-by-select pattern
      return db
        .query(
          `with existing as (
             select id from submissions
              where round_id = $1 and author_id = $2 and client_nonce = $3
           ), ins as (
             insert into submissions (round_id, author_id, content, claims, citations, status,
                                      submitted_at, canonical_sha256, signature_kind, signature_b64, signer_fingerprint, jwt_sub, client_nonce)
             select $1, $2, $4, $5, $6, 'submitted', now(), $7, $8, $9, $10, null, $3
             where not exists (select 1 from existing)
             returning id
           )
           select id from ins
           union all
           select id from existing
           limit 1`.replace(/\s+\n/g, ' '),
          [
            input.round_id,
            input.author_id,
            input.client_nonce,
            input.content,
            JSON.stringify(input.claims),
            JSON.stringify(input.citations),
            canonical_sha256,
            input.signature_kind || null,
            input.signature_b64 || null,
            input.signer_fingerprint || null
          ]
        )
        .then(async (r) => {
          let submission_id = r.rows[0]?.id;
          // If insert/select path failed to return id (no table/unique), emulate idempotency via memory fallback
          if (!submission_id) {
            if (memSubmissions.has(key)) {
              submission_id = memSubmissions.get(key).id;
            } else {
              submission_id = crypto.randomUUID();
              memSubmissions.set(key, { id: submission_id, canonical_sha256 });
            }
          }
          return res.json({ ok: true, submission_id, canonical_sha256 });
        })
        .catch((e) => {
          // Fallback to memory on DB failure; preserve idempotency
          let submission_id;
          if (memSubmissions.has(key)) {
            submission_id = memSubmissions.get(key).id;
          } else {
            submission_id = crypto.randomUUID();
            memSubmissions.set(key, { id: submission_id, canonical_sha256 });
          }
          return res.json({
            ok: true,
            submission_id,
            canonical_sha256,
            note: 'db_fallback',
            db_error: e.message
          });
        });
    } else {
      if (memSubmissions.has(key)) {
        const found = memSubmissions.get(key);
        return res.json({ ok: true, submission_id: found.id, canonical_sha256 });
      }
      const submission_id = crypto.randomUUID();
      memSubmissions.set(key, { id: submission_id, canonical_sha256 });
      return res.json({ ok: true, submission_id, canonical_sha256 });
    }
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// In-memory vote idempotency store and tallies
const memVotes = new Map(); // key -> { id, choice }
const memVoteTotals = new Map(); // room_id -> { yes, no }

function addVoteToTotals(roomId, choice) {
  const key = String(roomId);
  const t = memVoteTotals.get(key) || { yes: 0, no: 0 };
  if (choice === 'continue') t.yes += 1;
  else t.no += 1;
  memVoteTotals.set(key, t);
}

// vote.continue
app.post('/rpc/vote.continue', (req, res) => {
  try {
    const input = ContinueVote.parse(req.body);
    const key = `${input.round_id}:${input.voter_id}:continue:${input.client_nonce}`;
    if (db) {
      return db
        .query(
          `with existing as (
             select id from votes
              where round_id = $1 and voter_id = $2 and kind = 'continue' and client_nonce = $3
           ), ins as (
             insert into votes (room_id, round_id, voter_id, kind, ballot, client_nonce)
             select $4, $1, $2, 'continue', $5, $3
             where not exists (select 1 from existing)
             returning id
           )
           select id from ins
           union all
           select id from existing
           limit 1`.replace(/\s+\n/g, ' '),
          [
            input.round_id,
            input.voter_id,
            input.client_nonce,
            input.room_id,
            JSON.stringify({ choice: input.choice })
          ]
        )
        .then((r) => {
          const vote_id = r.rows[0]?.id || crypto.randomUUID();
          addVoteToTotals(input.room_id, input.choice);
          return res.json({ ok: true, vote_id });
        })
        .catch((_e) => {
          if (memVotes.has(key))
            return res.json({ ok: true, vote_id: memVotes.get(key).id, note: 'db_fallback' });
          const vote_id = crypto.randomUUID();
          memVotes.set(key, { id: vote_id, choice: input.choice });
          addVoteToTotals(input.room_id, input.choice);
          return res.json({ ok: true, vote_id, note: 'db_fallback' });
        });
    }
    if (memVotes.has(key)) return res.json({ ok: true, vote_id: memVotes.get(key).id });
    const vote_id = crypto.randomUUID();
    memVotes.set(key, { id: vote_id, choice: input.choice });
    addVoteToTotals(input.room_id, input.choice);
    return res.json({ ok: true, vote_id });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// In-memory room/round state and simple time-based transitions
const memRooms = new Map(); // room_id -> { round: { idx, phase, submit_deadline_unix, published_at_unix?, continue_vote_close_unix? } }
const SUBMIT_WINDOW_SEC = Number(process.env.SUBMIT_WINDOW_SEC || 300);
const CONTINUE_WINDOW_SEC = Number(process.env.CONTINUE_WINDOW_SEC || 30);

function ensureRoom(roomId) {
  let r = memRooms.get(roomId);
  const now = Math.floor(Date.now() / 1000);
  if (!r) {
    r = { round: { idx: 0, phase: 'submit', submit_deadline_unix: now + SUBMIT_WINDOW_SEC } };
    memRooms.set(roomId, r);
  }
  const round = r.round;
  // Simple phase transitions based on time windows (demo only)
  if (round.phase === 'submit' && now > round.submit_deadline_unix) {
    round.phase = 'published';
    round.published_at_unix = now;
    round.continue_vote_close_unix = now + CONTINUE_WINDOW_SEC;
  } else if (
    round.phase === 'published' &&
    round.continue_vote_close_unix &&
    now > round.continue_vote_close_unix
  ) {
    const tally = memVoteTotals.get(String(roomId)) || { yes: 0, no: 0 };
    if (tally.yes > tally.no) {
      r.round = {
        idx: round.idx + 1,
        phase: 'submit',
        submit_deadline_unix: now + SUBMIT_WINDOW_SEC
      };
    } else {
      round.phase = 'final';
    }
  }
  return r;
}

// Authoritative state snapshot (enriched)
app.get('/state', (req, res) => {
  const roomId = String(req.query.room_id || 'local');
  const state = ensureRoom(roomId);
  const round = state.round;
  const tally = memVoteTotals.get(roomId) || { yes: 0, no: 0 };
  return res.json({ ok: true, room_id: roomId, round: { ...round, continue_tally: tally } });
});

// SSE: timer events. Streams { t:'timer', room_id, ends_unix, round_idx, phase } every 1s.
app.get('/events', (req, res) => {
  const roomId = String(req.query.room_id || 'local');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = () => {
    const now = Math.floor(Date.now() / 1000);
    const { round } = ensureRoom(roomId);
    let ends = now;
    if (round.phase === 'submit' && round.submit_deadline_unix) ends = round.submit_deadline_unix;
    else if (round.phase === 'published' && round.continue_vote_close_unix)
      ends = round.continue_vote_close_unix;
    const payload = JSON.stringify({
      t: 'timer',
      room_id: roomId,
      ends_unix: ends,
      round_idx: round.idx,
      phase: round.phase
    });
    res.write(`event: timer\n`);
    res.write(`data: ${payload}\n\n`);
  };
  send();
  const iv = setInterval(send, 1000);
  req.on('close', () => {
    clearInterval(iv);
    res.end();
  });
});

export default app;

// If invoked directly, start server
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.error(`rpc listening on ${port}`));
}
