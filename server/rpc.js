import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { rateLimitStub } from './mw/rate-limit.js';
import { SubmissionIn, ContinueVote, SubmissionFlag } from './schemas.js';
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
const memSubmissions = new Map(); // key -> { id, canonical_sha256, content, author_id, room_id }
const memSubmissionIndex = new Map(); // submission_id -> { room_id }
const memFlags = new Map(); // submission_id -> Map(reporter_id -> { role, reason, created_at })

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
              author_id: input.author_id,
              room_id: input.room_id
            });
            memSubmissionIndex.set(submission_id, { room_id: input.room_id });
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
      author_id: input.author_id,
      room_id: input.room_id
    });
    memSubmissionIndex.set(submission_id, { room_id: input.room_id });
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
        .query('select vote_submit($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::text) as id', [
          input.room_id,
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

// submission.flag
app.post('/rpc/submission.flag', async (req, res) => {
  try {
    const input = SubmissionFlag.parse(req.body);
    const cleanReason = (input.reason || '').trim();
    if (db) {
      try {
        const result = await db.query(
          `with upsert as (
             insert into submission_flags (submission_id, reporter_id, reporter_role, reason)
             values ($1, $2, $3, $4)
             on conflict (submission_id, reporter_id)
             do update set reporter_role = excluded.reporter_role,
                           reason = excluded.reason,
                           created_at = now()
             returning submission_id
           )
           select submission_id,
                  (select count(*) from submission_flags where submission_id = $1) as flag_count
             from upsert`,
          [input.submission_id, input.reporter_id, input.reporter_role, cleanReason]
        );
        const count = Number(result.rows?.[0]?.flag_count || 0);
        return res.json({ ok: true, flag_count: count });
      } catch (e) {
        if (e?.code === '23503') {
          return res.status(404).json({ ok: false, error: 'submission_not_found' });
        }
        if (e?.code === '23505') {
          return res.status(200).json({ ok: true, note: 'duplicate_flag' });
        }
        // fall back to in-memory store if DB is unreachable or other errors occur
        const details =
          e?.message ||
          (Array.isArray(e?.errors) ? e.errors.map((err) => err.message).join('; ') : String(e));
        console.warn('submission.flag db error, falling back to memory', details);
      }
    }

    if (!memSubmissionIndex.has(input.submission_id)) {
      return res.status(404).json({ ok: false, error: 'submission_not_found' });
    }
    const existing = memFlags.get(input.submission_id) || new Map();
    const duplicate = existing.has(input.reporter_id);
    existing.set(input.reporter_id, {
      reporter_id: input.reporter_id,
      reporter_role: input.reporter_role,
      reason: cleanReason,
      created_at: Math.floor(Date.now() / 1000)
    });
    memFlags.set(input.submission_id, existing);
    const payload = { ok: true, flag_count: existing.size };
    if (duplicate) payload.note = 'duplicate_flag';
    return res.json(payload);
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
            `select s.id,
                    s.author_id,
                    s.content,
                    s.canonical_sha256,
                    s.submitted_at,
                    coalesce(f.flag_count, 0) as flag_count,
                    coalesce(f.flag_details, '[]'::jsonb) as flag_details
               from submissions s
               left join (
                 select submission_id,
                        count(*) as flag_count,
                        jsonb_agg(jsonb_build_object(
                          'reporter_id', reporter_id,
                          'reporter_role', reporter_role,
                          'reason', reason,
                          'created_at', extract(epoch from created_at)::bigint
                        ) order by created_at desc) as flag_details
                   from submission_flags
                  group by submission_id
               ) f on f.submission_id = s.id
              where s.round_id = $1
              order by s.submitted_at asc nulls last, s.id asc`,
            [roundRow.round_id]
          )
        ]);
        const tallyRow = tallyResult.rows?.[0] || { yes: 0, no: 0 };
        const transcript = submissionsResult.rows.map((row) => ({
          submission_id: row.id,
          author_id: row.author_id,
          content: row.content,
          canonical_sha256: row.canonical_sha256,
          submitted_at: row.submitted_at ? Math.floor(row.submitted_at.getTime() / 1000) : null,
          flag_count: Number(row.flag_count || 0),
          flags: Array.isArray(row.flag_details) ? row.flag_details : []
        }));
        const flagged = transcript
          .filter((entry) => entry.flag_count > 0)
          .map((entry) => ({ submission_id: entry.submission_id, flag_count: entry.flag_count }));
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
          },
          flags: flagged
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
    .map(([, value]) => {
      const flags = memFlags.get(value.id);
      const flagEntries = flags
        ? Array.from(flags.entries()).map(([, detail]) => ({
            reporter_id: detail.reporter_id,
            reporter_role: detail.reporter_role,
            reason: detail.reason,
            created_at: detail.created_at
          }))
        : [];
      return {
        submission_id: value.id,
        author_id: value.author_id,
        content: value.content,
        canonical_sha256: value.canonical_sha256,
        submitted_at: null,
        flag_count: flagEntries.length,
        flags: flagEntries
      };
    });
  const flagged = transcript
    .filter((entry) => entry.flag_count > 0)
    .map((entry) => ({ submission_id: entry.submission_id, flag_count: entry.flag_count }));
  return res.json({
    ok: true,
    room_id: roomId,
    round: { ...round, continue_tally: tally, transcript },
    flags: flagged
  });
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
if (config.nodeEnv !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = config.port;
  app.listen(port, () => console.error(`rpc listening on ${port}`));
}
