import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { rateLimitStub } from './mw/rate-limit.js';
import { SubmissionIn, ContinueVote } from './schemas.js';
import { canonicalize, sha256Hex } from './utils.js';
import { loadConfig } from './config/config-builder.js';

const app = express();
const config = loadConfig();
app.use(express.json());
app.use(rateLimitStub({ enforce: config.enforceRateLimit }));
// Serve static demo files (public/*) so you can preview UI in a browser
app.use(express.static('public'));

// Optional DB client (if DATABASE_URL provided)
let db = null;
if (config.databaseUrl) {
  try {
    db = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  } catch {
    db = null;
  }
}

export function __setDbPool(pool) {
  db = pool;
}

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// In-memory idempotency and submission store (M1 stub / fallback)
const memSubmissions = new Map(); // key -> { id, canonical_sha256, content, author_id }

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
      return db
        .query(
          'select submission_upsert($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb,$6::text,$7::text) as id',
          [
            input.round_id,
            input.author_id,
            input.content,
            JSON.stringify(input.claims),
            JSON.stringify(input.citations),
            canonical_sha256,
            input.client_nonce
          ]
        )
        .then((r) => {
          const submission_id = r.rows?.[0]?.id;
          if (submission_id) {
            return res.json({ ok: true, submission_id, canonical_sha256 });
          }
          throw new Error('submission_upsert_missing_id');
        })
        .catch((e) => {
          let submission_id;
          if (memSubmissions.has(key)) {
            submission_id = memSubmissions.get(key).id;
          } else {
            submission_id = crypto.randomUUID();
            memSubmissions.set(key, {
              id: submission_id,
              canonical_sha256,
              content: input.content,
              author_id: input.author_id
            });
          }
          return res.json({
            ok: true,
            submission_id,
            canonical_sha256,
            note: 'db_fallback',
            db_error: e.message
          });
        });
    }
    if (memSubmissions.has(key)) {
      const found = memSubmissions.get(key);
      return res.json({ ok: true, submission_id: found.id, canonical_sha256 });
    }
    const submission_id = crypto.randomUUID();
    memSubmissions.set(key, {
      id: submission_id,
      canonical_sha256,
      content: input.content,
      author_id: input.author_id
    });
    return res.json({ ok: true, submission_id, canonical_sha256 });
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
        .query('select vote_submit($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::text) as id', [
          input.round_id,
          input.voter_id,
          'continue',
          JSON.stringify({ choice: input.choice }),
          input.client_nonce
        ])
        .then((r) => {
          const vote_id = r.rows?.[0]?.id;
          if (vote_id) {
            addVoteToTotals(input.room_id, input.choice);
            return res.json({ ok: true, vote_id });
          }
          throw new Error('vote_submit_missing_id');
        })
        .catch((e) => {
          if (memVotes.has(key))
            return res.json({
              ok: true,
              vote_id: memVotes.get(key).id,
              note: 'db_fallback',
              db_error: e.message
            });
          const vote_id = crypto.randomUUID();
          memVotes.set(key, { id: vote_id, choice: input.choice });
          addVoteToTotals(input.room_id, input.choice);
          return res.json({ ok: true, vote_id, note: 'db_fallback', db_error: e.message });
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
const SUBMIT_WINDOW_SEC = config.submitWindowSec;
const CONTINUE_WINDOW_SEC = config.continueWindowSec;

function ensureRoom(roomId) {
  let r = memRooms.get(roomId);
  const now = Math.floor(Date.now() / 1000);
  const justCreated = !r;
  if (!r) {
    r = { round: { idx: 0, phase: 'submit', submit_deadline_unix: now + SUBMIT_WINDOW_SEC } };
    memRooms.set(roomId, r);
  }
  const round = r.round;
  // Simple phase transitions based on time windows (demo only)
  if (justCreated) return r; // avoid flipping in the same tick as creation
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
app.get('/state', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');
  if (db) {
    try {
      const roundResult = await db.query(
        `select room_id, round_id, idx, phase, submit_deadline_unix,
                published_at_unix, continue_vote_close_unix
           from view_current_round
          where room_id = $1
          order by idx desc
          limit 1`,
        [roomId]
      );
      const roundRow = roundResult.rows?.[0];
      if (roundRow) {
        const [tallyResult, submissionsResult] = await Promise.all([
          db.query(
            'select yes, no from view_continue_tally where room_id = $1 and round_id = $2 limit 1',
            [roomId, roundRow.round_id]
          ),
          db.query(
            `select id, author_id, content, canonical_sha256, submitted_at
               from submissions_view
              where round_id = $1
              order by submitted_at asc nulls last, id asc`,
            [roundRow.round_id]
          )
        ]);
        const tallyRow = tallyResult.rows?.[0] || { yes: 0, no: 0 };
        const transcript = submissionsResult.rows.map((row) => ({
          submission_id: row.id,
          author_id: row.author_id,
          content: row.content,
          canonical_sha256: row.canonical_sha256,
          submitted_at: row.submitted_at ? Math.floor(row.submitted_at.getTime() / 1000) : null
        }));
        return res.json({
          ok: true,
          room_id: roomId,
          round: {
            idx: roundRow.idx,
            phase: roundRow.phase,
            submit_deadline_unix: roundRow.submit_deadline_unix,
            published_at_unix: roundRow.published_at_unix,
            continue_vote_close_unix: roundRow.continue_vote_close_unix,
            continue_tally: {
              yes: Number(tallyRow.yes || 0),
              no: Number(tallyRow.no || 0)
            },
            transcript
          }
        });
      }
    } catch {
      // fall through to in-memory state on error
    }
  }
  const state = ensureRoom(roomId);
  const round = state.round;
  const tally = memVoteTotals.get(roomId) || { yes: 0, no: 0 };
  const transcript = Array.from(memSubmissions.entries())
    .filter(([key]) => key.startsWith(`${roomId}:`))
    .map(([, value]) => ({
      submission_id: value.id,
      author_id: value.author_id,
      content: value.content,
      canonical_sha256: value.canonical_sha256,
      submitted_at: null
    }));
  return res.json({
    ok: true,
    room_id: roomId,
    round: { ...round, continue_tally: tally, transcript }
  });
});

// SSE: timer events. Streams { t:'timer', room_id, ends_unix, round_idx, phase } every 1s.
app.get('/events', async (req, res) => {
  const roomId = String(req.query.room_id || 'local');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // If DB is configured, drive events from DB state + LISTEN/NOTIFY.
  let currentRound = null;
  let listenerClient = null;
  let closed = false;

  async function loadCurrentRound() {
    if (!db) return null;
    const r = await db.query(
      `select room_id, round_id, idx, phase, submit_deadline_unix,
              published_at_unix, continue_vote_close_unix
         from view_current_round
        where room_id = $1
        order by idx desc
        limit 1`,
      [roomId]
    );
    currentRound = r.rows?.[0] || null;
    return currentRound;
  }

  function endsUnixFromRound(roundRow) {
    const now = Math.floor(Date.now() / 1000);
    if (!roundRow) return now;
    if (roundRow.phase === 'submit' && roundRow.submit_deadline_unix)
      return Number(roundRow.submit_deadline_unix);
    if (roundRow.phase === 'published' && roundRow.continue_vote_close_unix)
      return Number(roundRow.continue_vote_close_unix);
    return now;
  }

  function sendTimer() {
    const now = Math.floor(Date.now() / 1000);
    const round = currentRound || ensureRoom(roomId).round;
    const payload = JSON.stringify({
      t: 'timer',
      room_id: roomId,
      ends_unix: endsUnixFromRound(currentRound) || now,
      round_idx: round.idx ?? currentRound?.idx ?? 0,
      phase: round.phase ?? currentRound?.phase ?? 'submit'
    });
    res.write(`event: timer\n`);
    res.write(`data: ${payload}\n\n`);
  }

  // Start timer tick now; DB listener will update currentRound and emit 'phase'.
  const iv = setInterval(() => {
    try {
      if (!closed) sendTimer();
    } catch {
      /* ignore */
    }
  }, 1000);

  try {
    if (db) {
      await loadCurrentRound();
      listenerClient = await db.connect();
      await listenerClient.query('LISTEN db8_rounds');
      const onNotification = (msg) => {
        if (msg.channel !== 'db8_rounds' || closed) return;
        try {
          const payload = JSON.parse(msg.payload || '{}');
          if (payload.room_id !== roomId) return;
          // Update cached round and emit a phase event immediately
          currentRound = {
            room_id: payload.room_id,
            round_id: payload.round_id,
            idx: payload.idx,
            phase: payload.phase,
            submit_deadline_unix: payload.submit_deadline_unix,
            published_at_unix: payload.published_at_unix,
            continue_vote_close_unix: payload.continue_vote_close_unix
          };
          res.write(`event: phase\n`);
          res.write(`data: ${JSON.stringify({ t: 'phase', ...currentRound })}\n\n`);
        } catch {
          // ignore bad payloads
        }
      };
      listenerClient.on('notification', onNotification);
      // Attach to underlying pg Client to get notifications
      listenerClient.connection?.stream?.on?.('error', () => {});

      // Ensure cleanup
      req.on('close', async () => {
        closed = true;
        clearInterval(iv);
        try {
          if (listenerClient) {
            listenerClient.removeListener('notification', onNotification);
            await listenerClient.query('UNLISTEN db8_rounds');
            listenerClient.release();
          }
        } catch {
          /* ignore */
        }
        res.end();
      });

      // send initial timer frame promptly
      sendTimer();
      return;
    }
  } catch {
    // If DB path fails, fall back to in-memory
  }

  // Fallback to in-memory authority when DB is unavailable
  req.on('close', () => {
    closed = true;
    clearInterval(iv);
    res.end();
  });
  sendTimer();
});

export default app;

// If invoked directly, start server
if (config.nodeEnv !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = config.port;
  app.listen(port, () => console.error(`rpc listening on ${port}`));
}
